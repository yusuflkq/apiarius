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
  DeckData,
  DeckEdit,
  DeckKind,
  DeckMessage,
  DeckMessageKind,
  DeckStatus,
  DeckView,
} from '../types'
import { baseName, oneLine, trunc, truncStart } from './format'

export const MAIN = 'main'
export const YOU = 'you'
/** What the deck calls the main loop (internal id `main`) everywhere it draws it. */
export const ORCHESTRATOR = 'Orchestrator'
export const SNAPSHOT_VERSION = 2

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
    turns: 0,
    turnMs: 0,
  }
}

export function defaultView(): DeckView {
  return {
    tab: 'overview',
    agent: MAIN,
    agentPane: 'activity',
    file: '',
    commit: '',
    filter: 'all',
    showFiles: true,
    isBandHidden: false,
  }
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
  return data
}
