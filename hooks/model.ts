/**
 * The deck's data: every agent of the session (you, the main loop, each
 * subagent or teammate, outside peers), what each is doing now, the exact
 * edits each made, the messages between them, and per-minute activity.
 *
 * Pure: the hooks module owns the one live copy and mutates it through
 * these helpers; nothing here reaches the engine.
 */
import type {
  DeckActivity,
  DeckAgent,
  DeckAgentPane,
  DeckData,
  DeckEdit,
  DeckKind,
  DeckMapView,
  DeckMessage,
  DeckMessageKind,
  DeckNeeds,
  DeckShownStatus,
  DeckStatus,
  DeckTab,
  DeckView,
} from '../types'
import { baseName, dur, firstLine, oneLine, plural, trunc, truncStart } from './format'
import type { GitState } from './git'

export const MAIN = 'main'
export const YOU = 'you'
/** What the deck calls the main loop (internal id `main`) everywhere it draws it. */
export const ORCHESTRATOR = 'Orchestrator'
/**
 * The snapshot's shape. Kept at 2 on purpose: a reload restores the session's
 * agents, and `healData` / `healView` fill or fix what an older shape lacks.
 */
export const SNAPSHOT_VERSION = 2

/** The pane's tabs, in the order the tab row draws them. */
export const TABS: readonly DeckTab[] = ['agents', 'changes', 'stats']
export const AGENT_PANES: readonly DeckAgentPane[] = ['activity', 'edits', 'chat']
export const MAP_VIEWS: readonly DeckMapView[] = ['tree', 'wire']

/** Earlier builds' tabs, by the tab that took each one's place: a saved view or a typed `/deck overview` still lands. */
export const OLD_TABS: ReadonlyMap<string, DeckTab> = new Map<string, DeckTab>([
  ['overview', 'stats'],
  ['diffs', 'changes'],
  ['commits', 'changes'],
  ['graph', 'agents'],
  ['flow', 'agents'],
])

/** The tab `name` is: one of TABS, or the one an earlier build's name became; undefined for anything else. */
export function tabNamed(name: unknown): DeckTab | undefined {
  if (typeof name !== 'string') return undefined
  return TABS.find(tab => tab === name) ?? OLD_TABS.get(name)
}

/** The tab a `/deck` argument asks for: a tab's name or its start (`c`), today's names before earlier builds'. */
export function tabFor(arg: string): DeckTab | undefined {
  const wanted = arg.trim().toLowerCase()
  if (wanted === '') return undefined
  const tab = TABS.find(one => one.startsWith(wanted))
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
  promptChars: 700,
  answerChars: 1400,
  messageChars: 700,
  agents: 80,
} as const

export const EDIT_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']
export const SHELL_TOOLS: readonly string[] = ['Bash', 'PowerShell']
/** Calls that keep the agent's own lists: never "what it's doing", which their items say instead. */
export const LIST_TOOLS: readonly string[] = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']

export function isLive(status: DeckStatus): boolean {
  return status === 'running' || status === 'waiting' || status === 'pending'
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
  }
}

export function defaultView(): DeckView {
  return {
    tab: 'agents',
    agent: MAIN,
    agentPane: 'edits',
    file: '',
    commit: '',
    filter: 'all',
    showFiles: true,
    isBandHidden: false,
    map: 'tree',
    message: '',
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * A view restored from a snapshot, field by field: one missing, of another
 * type, or naming a tab or map view this build lacks takes its default; an
 * earlier build's tab name becomes the tab that took its place (`tabNamed`).
 * With `data`, an agent or a message it no longer holds is let go too.
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
    map: oneOf(v.map, MAP_VIEWS, base.map),
    message: text(v.message, base.message),
  }
  if (data) {
    if (view.agent !== '' && !agentOf(data, view.agent)) view.agent = base.agent
    if (view.message !== '' && !data.messages.some(message => message.id === view.message)) view.message = ''
  }
  return view
}

export function agentOf(data: DeckData, id: string): DeckAgent | undefined {
  return data.agents.find(agent => agent.id === id)
}

/** The agent under `id`, made on first sight (a subagent seen before its spawn was). */
export function ensureAgent(data: DeckData, id: string, now: number): DeckAgent {
  const found = agentOf(data, id)
  if (found) return found

  const made = newAgent(id, 'agent', `agent-${id.slice(0, 6)}`, now, {
    type: 'subagent',
    parentId: MAIN,
    status: 'running',
  })
  data.agents.push(made)
  pruneAgents(data)
  return made
}

function pruneAgents(data: DeckData) {
  if (data.agents.length <= LIMITS.agents) return
  const removable = data.agents.filter(agent => agent.kind !== 'you' && agent.kind !== 'main' && isEnded(agent.status))
  const drop = new Set(removable.slice(0, data.agents.length - LIMITS.agents).map(agent => agent.id))
  data.agents = data.agents.filter(agent => !drop.has(agent.id))
}

/** A short label for the agent: its name, else its description, else its type; the main loop is the Orchestrator. */
export function labelOf(agent: DeckAgent): string {
  if (agent.kind === 'main') return ORCHESTRATOR
  if (agent.kind === 'you') return agent.name
  const named = agent.name && !agent.name.startsWith('agent-') ? agent.name : ''
  return trunc(named || agent.description || agent.type || agent.name, 28)
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

/** What a tool call is aimed at, in a few words: the file, command, pattern or query. */
export function targetOf(tool: string, input: Record<string, unknown>, root: string | null): string {
  const file = str(input.file_path) ?? str(input.notebook_path)
  if (file) return truncStart(relOf(file, root), 60)

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
    default: {
      if (tool.startsWith('mcp__')) return trunc(tool.split('__').slice(1).join(' / '), 60)
      const first = Object.values(input).find(value => typeof value === 'string')
      return typeof first === 'string' ? trunc(oneLine(first), 60) : ''
    }
  }
}

/** One tool call as the deck keeps it: what it is aimed at, and a shell call's own description of itself. */
export function activityOf(id: string, tool: string, input: Record<string, unknown>, root: string | null, at: number): DeckActivity {
  const described = SHELL_TOOLS.includes(tool) ? str(input.description) : undefined
  const description = described ? trunc(oneLine(described), 80) : ''
  return { id, tool, target: targetOf(tool, input, root), at, ...(description ? { description } : {}) }
}

export function beginTool(data: DeckData, agent: DeckAgent, activity: DeckActivity) {
  agent.current = activity
  agent.tools += 1
  agent.toolCounts[activity.tool] = (agent.toolCounts[activity.tool] ?? 0) + 1
  agent.lastAt = activity.at
  agent.recent.push(activity)
  if (agent.recent.length > LIMITS.recent) agent.recent.splice(0, agent.recent.length - LIMITS.recent)
  if (agent.kind !== 'you' && !isEnded(agent.status)) agent.status = 'running'
  bump(data, activity.at, 'tools')
}

export function endTool(agent: DeckAgent, id: string, ok: boolean, now: number) {
  const entry = agent.recent.find(one => one.id === id)
  if (entry) {
    entry.ok = ok
    entry.ms = now - entry.at
  }
  if (agent.current?.id === id) agent.current = undefined
  if (!ok) agent.errors += 1
  agent.lastAt = now
}

export function addEdit(data: DeckData, agent: DeckAgent, edit: DeckEdit) {
  data.edits.push(edit)
  if (data.edits.length > LIMITS.edits) data.edits.splice(0, data.edits.length - LIMITS.edits)
  agent.added += edit.added
  agent.removed += edit.removed
  if (!agent.files.includes(edit.path)) agent.files.push(edit.path)
  if (agent.files.length > 200) agent.files.splice(0, agent.files.length - 200)
  bump(data, edit.at, 'edits')
}

export function addMessage(
  data: DeckData,
  message: Omit<DeckMessage, 'id' | 'text'> & { text: string },
): DeckMessage {
  const made: DeckMessage = {
    ...message,
    id: `${message.at}-${data.messages.length}-${message.from}-${message.to}`,
    text: trunc(message.text.trim(), LIMITS.messageChars),
  }
  data.messages.push(made)
  if (data.messages.length > LIMITS.messages) data.messages.splice(0, data.messages.length - LIMITS.messages)
  return made
}

/** Finds an agent a SendMessage `to` names: an id, a name, a teammate address, or "main". */
export function resolveRecipient(data: DeckData, to: string): DeckAgent | undefined {
  const wanted = to.trim()
  if (wanted === '' ) return undefined
  if (wanted === MAIN || wanted === 'team-lead' || wanted === 'lead') return agentOf(data, MAIN)
  const lower = wanted.toLowerCase()
  return (
    data.agents.find(agent => agent.id === wanted) ??
    data.agents.find(agent => agent.name.toLowerCase() === lower) ??
    data.agents.find(agent => agent.name.toLowerCase() === lower.split('@')[0]) ??
    data.agents.find(agent => agent.id.startsWith(wanted) && wanted.length >= 6)
  )
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

/** Fills fields a snapshot from an older shape may lack. */
export function healData(value: DeckData, now: number): DeckData {
  const base = emptyData(now)
  const data = { ...base, ...value }
  data.agents = Array.isArray(value.agents) ? value.agents.map(agent => ({ ...newAgent(agent.id, agent.kind, agent.name, now), ...agent })) : base.agents
  if (!agentOf(data, YOU)) data.agents.unshift(base.agents[0] as DeckAgent)
  if (!agentOf(data, MAIN)) data.agents.splice(1, 0, base.agents[1] as DeckAgent)
  data.messages = Array.isArray(value.messages) ? value.messages : []
  data.edits = Array.isArray(value.edits) ? value.edits : []
  data.minutes = Array.isArray(value.minutes) ? value.minutes : []
  data.commitsBy = value.commitsBy && typeof value.commitsBy === 'object' ? value.commitsBy : {}
  data.tasks = isRecord(value.tasks) ? (value.tasks as Record<string, string>) : {}
  return data
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
 * for it (a needs-you note) or its loop is held; `running` for a pending or
 * running loop; `done` once it completed; `failed` once it failed or was
 * stopped; `idle` between turns, and always for you and outside peers.
 */
export function statusOf(agent: DeckAgent): DeckShownStatus {
  if (agent.kind === 'you' || agent.kind === 'peer') return 'idle'
  if (agent.needs) return 'waiting'
  switch (agent.status) {
    case 'running':
    case 'pending':
      return 'running'
    case 'waiting':
      return 'waiting'
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
  if (agent.endedAt !== undefined) return dur(Math.max(0, agent.endedAt - agent.startedAt))
  const ms = Math.max(0, now - agent.startedAt)
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
 * TodoWrite's in-progress item (its activeForm, else its content; none
 * clears it); a TaskUpdate that starts a task (its activeForm, else the
 * words its TaskCreate booked, else its subject) or ends the task in hand.
 * TaskCreate books the task's words for that later start. Others: nothing.
 */
export function noteTodo(data: DeckData, agent: DeckAgent, tool: string, input: Record<string, unknown>, result: unknown): void {
  if (tool === 'TodoWrite') {
    const todos = Array.isArray(input.todos) ? input.todos.filter(isRecord) : []
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

const NEEDS_KINDS: readonly string[] = ['permission_prompt', 'idle_prompt', 'elicitation_dialog']
const NOT_NEEDS_KINDS: readonly string[] = ['auth_success', 'elicitation_complete', 'elicitation_response']

/** Whether a notification asks something of the person: a permission prompt, an MCP server's question, Claude waiting for input. */
export function isNeedsYou(kind: string, message: string): boolean {
  if (NEEDS_KINDS.includes(kind)) return true
  if (NOT_NEEDS_KINDS.includes(kind)) return false
  return /permission|waiting for your|needs your|your (input|approval|answer)/i.test(message)
}

/**
 * The call in flight a notification waits on: the newest call of the tool a
 * permission prompt names ("…permission to use Bash"), or of any MCP tool
 * for a server's question; within `agentId`'s loop when one is named.
 */
function waitingCallOf(data: DeckData, kind: string, message: string, agentId: string | undefined): { agent: string; call: string } | undefined {
  if (kind === 'idle_prompt') return undefined
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
 * Notes on the Orchestrator that the engine waits on the person, with the
 * agent and the call that wait when they can be told (`agent` is the
 * notification's own `agent_id`, when it carried one). Answers the note.
 */
export function noteNeeds(data: DeckData, note: { kind: string; text: string; at: number; agent?: string }): DeckNeeds | undefined {
  const main = agentOf(data, MAIN)
  if (!main) return undefined
  const named = note.agent !== undefined && agentOf(data, note.agent) ? note.agent : undefined
  const waiting = waitingCallOf(data, note.kind, note.text, named)
  const agent = waiting?.agent ?? named
  const needs: DeckNeeds = {
    text: trunc(oneLine(note.text), NOTE_CHARS) || 'Claude is waiting for you',
    kind: note.kind,
    at: note.at,
    ...(agent !== undefined ? { agent } : {}),
    ...(waiting ? { call: waiting.call } : {}),
  }
  main.needs = needs
  return needs
}

/** What moved since the engine started waiting on the person. */
export type NeedsMove = { kind: 'turn' } | { kind: 'start'; agent: string } | { kind: 'end'; agent: string; call: string }

/**
 * Takes the needs-you note down once what it waited on moved: a turn
 * starting; the agent it waits on starting another call; the call it waits
 * on ending (with no call told, any call of that agent ending). The agent
 * is the Orchestrator unless the note names another. Answers whether it did.
 */
export function clearNeeds(data: DeckData, move: NeedsMove): boolean {
  const main = agentOf(data, MAIN)
  const needs = main?.needs
  if (!main || !needs) return false
  const owner = needs.agent ?? MAIN
  const isMoved =
    move.kind === 'turn' || (move.kind === 'start' ? move.agent === owner : needs.call !== undefined ? move.call === needs.call : move.agent === owner)
  if (isMoved) delete main.needs
  return isMoved
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
    if (message.from === message.to) continue
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
