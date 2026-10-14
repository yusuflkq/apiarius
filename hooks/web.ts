/**
 * The web deck's half of the mod: what `.web/<sessionId>/state.json` holds
 * (`webStateOf`, the v1 `WebState` of web/CONTRACT.md), the patch files
 * written beside it, and the lines the server prints back (`splitLines`,
 * `parseLine`, `routeOf`).
 *
 * Pure, like the model: nothing here reads a clock but the `now` it is
 * handed, and every query is model.ts's own, so the page and the pane say
 * the same thing. The hooks module (register.tsx) writes the files, starts
 * the server and acts on the commands.
 */
import type { DeckAgent, DeckData, DeckStepStatus, DeckView } from '../types'
import * as F from './format'
import type { GitState } from './git'
import * as M from './model'
import { shownStatusOf } from './ui/outlineModel'
import type { UsageInfo } from './ui/types'

// The state file (web/CONTRACT.md, v1).

export type WebStatus = 'starting' | 'running' | 'waiting' | 'done' | 'failed' | 'idle'
export type WebKind = 'orchestrator' | 'agent' | 'teammate' | 'peer' | 'background'
export type WebItemStatus = 'done' | 'active' | 'pending'

export type WebAgent = {
  /** 'main' is the Orchestrator. */
  id: string
  label: string
  scope: string
  /** 'main loop', 'Explore', 'general-purpose', … */
  type: string
  /** Short: 'opus-5.5', 'haiku-4.5'. */
  model: string
  kind: WebKind
  /** The Orchestrator's is null; the user is not an agent here. */
  parent: string | null
  status: WebStatus
  /** `allow Bash "npm test"` while it waits on the user. */
  needsYou: string | null
  startedAt: number
  endedAt: number | null
  /** The one line: its current step, last action or result. */
  now: string
  /** The prompt it was given (the Orchestrator's: the goal), at most 2000 characters. */
  task: string
  /** Its final report, at most 4000 characters; '' until done. The Orchestrator's: its latest answer to you. */
  result: string
  /** Its todo list or board tasks; the Orchestrator's, with no list of its own: the plan's steps. */
  checklist: { items: { text: string; status: WebItemStatus; doing?: string }[]; done: number; total: number }
  lastAction: { tool: string; text: string; at: number; isLive: boolean } | null
  tools: number
  errors: number
  tokens: { in: number; out: number; cacheRead: number }
  added: number
  removed: number
  /** Repo-relative where possible. */
  files: string[]
  /** 0–9, stable per agent: a hash of its id. */
  avatar: number
}

export type WebState = {
  v: 1
  /** When it was written, ms since the epoch. */
  now: number
  session: { id: string; cwd: string; startedAt: number; model: string }
  repo: { name: string; root: string; branch: string; ahead: number; behind: number; head: string } | null
  goal: { headline: string; text: string; at: number; followUps: { text: string; at: number }[] } | null
  needs: { tone: 'alert' | 'attention' | 'done' | 'quiet'; kind: string; text: string; agentId?: string; path?: string }
  summary: {
    /** "2 of 4". */
    step: string | null
    /** The active step's text. */
    stepText: string | null
    running: number
    waiting: number
    done: number
    failed: number
    files: number
    added: number
    removed: number
    /** Since the goal (or the session) started. */
    minutes: number
    /** All agents, in + out + cache reads. */
    tokens: number
    costUsd: number | null
    contextPercent: number | null
  }
  plan: { source: M.DeckPlanSource; steps: { key: string; text: string; status: DeckStepStatus; agents: string[] }[] }
  agents: WebAgent[]
  /** The newest 200, oldest first, each text at most 600 characters; 'you' is the user. */
  messages: { id: string; at: number; from: string; to: string; kind: 'prompt' | 'spawn' | 'result' | 'message' | 'chat'; text: string }[]
  /** The newest 150 tool calls of all agents, oldest first. */
  activity: { at: number; agent: string; tool: string; target: string; ok: boolean | null; ms: number | null }[]
  /** Every file agents edited, the one edited last first. */
  files: { path: string; editors: string[]; live: boolean; isShared: boolean; added: number; removed: number; lastAt: number }[]
  /** The newest 300, oldest first; each one's patch at /patch/<id>. */
  edits: { id: string; agent: string; tool: string; path: string; at: number; added: number; removed: number }[]
  /** Git's uncommitted files. */
  changes: { path: string; code: string; added: number; removed: number; editors: string[] }[]
  /** The newest 20, newest first. */
  commits: { hash: string; short: string; subject: string; author: string; at: number; added: number; removed: number; files: number; agent: string | null }[]
}

/** The contract's sizes. */
export const WEB_CAPS = { task: 2000, result: 4000, messages: 200, messageChars: 600, activity: 150, edits: 300, commits: 20 } as const

/** The longest command text the mod acts on. */
export const MOST_TEXT = 4000

/** How often state.json is written at most while the data changes. */
export const WEB_WRITE_MS = 300

/** The folder under the mod's root that holds each session's files. */
export const WEB_DIR = '.web'

/** A name safe as one path segment (a session's id, an edit's): `[A-Za-z0-9_-]` kept, anything else `_`. */
export function fileNameOf(id: string): string {
  const name = id.replace(/[^A-Za-z0-9_-]/g, '_')
  return name === '' ? 'session' : name
}

/** The session's folder: `<root>/.web/<sessionId>`. */
export function webDirOf(root: string, sessionId: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${WEB_DIR}/${fileNameOf(sessionId || 'session')}`
}

/**
 * An edit's id as the server takes it (`[A-Za-z0-9_-]` only): a tool call's
 * id stays as it is; any other character becomes `-` and its code in hex,
 * `-` itself included, so two ids never meet (`toolu_1:0` is `toolu_1-3a0`).
 */
export function webIdOf(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, ch => `-${ch.charCodeAt(0).toString(16)}`)
}

/** An agent's persona, 0 to 9: the same id, the same avatar, in every write and session. */
export function avatarOf(id: string): number {
  return F.hash(id) % 10
}

/** A model's short name: `claude-opus-5-5` is `opus-5.5`, `claude-haiku-4-5-20251001` is `haiku-4.5`; '' for none. */
export function shortModel(model: string | undefined): string {
  let name = (model ?? '').trim().toLowerCase().replace(/\[[^\]]*\]/g, '')
  const at = name.lastIndexOf('claude-')
  if (at >= 0) name = name.slice(at + 'claude-'.length)
  name = name.replace(/[-@]\d{8}(?:-v\d+(?::\d+)?)?$/, '')
  const family = /^([a-z]+)-(\d+)-(\d+)$/.exec(name)
  if (family) return `${family[1]}-${family[2]}.${family[3]}`
  const old = /^(\d+)-(\d+)-([a-z]+)$/.exec(name)
  if (old) return `${old[3]}-${old[1]}.${old[2]}`
  const major = /^(\d+)-([a-z]+)$/.exec(name)
  if (major) return `${major[2]}-${major[1]}`
  return name
}

/** What the agent is to the page: the Orchestrator, a subagent, a teammate, an outside peer, or a workflow or housekeeping loop. */
function kindOf(agent: DeckAgent): WebKind {
  if (agent.kind === 'main') return 'orchestrator'
  if (agent.kind === 'peer') return 'peer'
  if (M.isFolded(agent)) return 'background'
  return agent.kind === 'teammate' ? 'teammate' : 'agent'
}

/** The status the page draws: the pane's own (a wait on anything but you is work going on), with a placeholder `starting`. */
function statusOf(agent: DeckAgent, data: DeckData): WebStatus {
  if (agent.status === 'starting') return 'starting'
  return shownStatusOf(agent, data)
}

/** What the engine waits on the person for, when it waits for this agent: `allow Bash "npm test"`; null otherwise. */
function needsYouOf(data: DeckData, agent: DeckAgent): string | null {
  const needs = M.agentOf(data, M.MAIN)?.needs
  if (!needs || (needs.agent ?? M.MAIN) !== agent.id) return null
  return M.waitingOnOf(data, needs)
}

/** Why an agent failed, in one line: its report's, else its last failed call's. */
function failureOf(agent: DeckAgent, root: string): string {
  const said = agent.answer ? M.resultLineOf(agent.answer, root, true) : ''
  if (said) return said
  for (let i = agent.recent.length - 1; i >= 0; i--) {
    const one = agent.recent[i]
    if (one?.ok === false) return `${one.tool} ${one.target} failed`.trim()
  }
  return ''
}

/** The agent's one line, as the page and the pane's summary show it: where it is, as its status says it; `root` is the repository shown. */
export function agentLineOf(data: DeckData, agent: DeckAgent, root: string): string {
  return nowLineOf(data, agent, statusOf(agent, data), needsYouOf(data, agent), root)
}

function nowLineOf(data: DeckData, agent: DeckAgent, status: WebStatus, needsYou: string | null, root: string): string {
  const last = M.lastActionOf(agent)
  const action = last?.text ?? ''
  if (needsYou !== null) return `Waits on you: ${needsYou}`
  if (agent.kind === 'main') {
    // between turns: what it last answered you; at work: its call in flight, the agents it waits on, its step. An earlier
    // turn's last call is no news (a background agent's notification starts a turn long after it), so it is never shown.
    if (status === 'idle') return (agent.answer ? M.resultLineOf(agent.answer, root) : '') || 'Idle'
    if (last?.isLive) return F.oneLine(action)
    const live = data.agents.filter(one => M.isShownAgent(one) && M.isLive(one.status) && M.parentIdOf(data, one) === M.MAIN).length
    if (live > 0) return `Waiting on ${F.plural(live, 'agent')}`
    return F.oneLine(M.stepOf(agent)) || 'Working'
  }
  switch (status) {
    case 'failed': {
      if (agent.status === 'killed') return 'Stopped'
      const why = failureOf(agent, root)
      return why ? `Failed: ${why}` : 'Failed'
    }
    case 'done':
      return (agent.answer ? M.resultLineOf(agent.answer, root) : '') || 'Done'
    case 'idle':
      return action || 'Idle'
    case 'waiting':
      return action ? `Waiting: ${action}` : 'Waiting'
    default:
      return F.oneLine(M.stepOf(agent) || action || M.scopeOf(agent) || agent.description) || (status === 'starting' ? 'Starting' : 'Working')
  }
}

/**
 * The agent's checklist: its own todo list or board tasks; the Orchestrator
 * with none of its own has the plan's steps, which it wrote (a board's tasks)
 * or works through (`plan`, the goal's).
 */
function checklistOf(data: DeckData, agent: DeckAgent, plan: M.DeckPlan): M.DeckChecklist {
  const own = M.checklistOf(agent, data)
  if (agent.kind !== 'main' || own.total > 0 || plan.steps.length === 0) return own
  const items = plan.steps.map(step => ({ key: step.key, text: step.text, status: step.status }))
  return { items, done: items.filter(item => item.status === 'done').length, total: items.length }
}

function webAgentOf(data: DeckData, agent: DeckAgent, root: string, plan: M.DeckPlan): WebAgent {
  const status = statusOf(agent, data)
  const needsYou = needsYouOf(data, agent)
  const list = checklistOf(data, agent, plan)
  const action = M.lastActionOf(agent)
  const parent = agent.kind === 'main' ? null : (M.parentIdOf(data, agent) ?? null)
  const goal = M.goalOf(data)
  const task = agent.kind === 'main' ? (goal?.text ?? '') : agent.prompt || agent.description
  return {
    id: agent.id,
    label: M.labelOf(agent),
    scope: M.scopeOf(agent),
    type: agent.type,
    model: shortModel(agent.model),
    kind: kindOf(agent),
    parent: parent === M.YOU ? null : parent,
    status,
    needsYou,
    startedAt: agent.startedAt,
    endedAt: agent.endedAt ?? null,
    now: nowLineOf(data, agent, status, needsYou, root),
    task: F.trunc(task, WEB_CAPS.task),
    result: F.trunc(agent.answer ?? '', WEB_CAPS.result),
    checklist: {
      items: list.items.map(item => ({ text: item.text, status: item.status === 'failed' ? 'pending' : item.status, ...(item.doing ? { doing: item.doing } : {}) })),
      done: list.done,
      total: list.total,
    },
    // the line without the tool's name in front: the page draws the tool beside it
    lastAction: action ? { tool: action.tool, text: action.text.startsWith(`${action.tool} `) ? action.text.slice(action.tool.length + 1) : action.text, at: action.at, isLive: action.isLive } : null,
    tools: agent.tools,
    errors: agent.errors,
    tokens: { in: agent.tokensIn, out: agent.tokensOut, cacheRead: agent.cacheRead },
    added: agent.added,
    removed: agent.removed,
    files: [...agent.files],
    avatar: avatarOf(agent.id),
  }
}

/** Who edited each path the deck shows, by its spelling for comparing. */
function editorsByPath(data: DeckData): Map<string, string[]> {
  const byPath = new Map<string, string[]>()
  for (const file of M.filesOf(data)) byPath.set(M.normPath(file.path), file.editors)
  return byPath
}

/**
 * The whole state the page reads, as web/CONTRACT.md (v1) lays it out, from
 * the deck's live model at `now`. `view` is the pane's and changes nothing
 * here: the page keeps its own.
 */
export function webStateOf(data: DeckData, view: DeckView, git: GitState, usage: UsageInfo | null, now: number, sessionId: string, cwd: string): WebState {
  void view
  const root = git.root || ''
  const goal = M.goalOf(data)
  const plan = M.planOf(data)
  const sum = M.summaryOf(data, git, now)
  const needs = M.needsOf(data, git, now)
  const totals = M.totalsOf(data)
  const main = M.agentOf(data, M.MAIN)
  const active = plan.steps.find(step => step.status === 'active')
  const isRepo = git.isRepo === true && root !== ''
  const editors = editorsByPath(data)
  const agents = data.agents.filter(agent => agent.kind !== 'you')

  const activity = agents
    .flatMap(agent => agent.recent.map(one => ({ at: one.at, agent: agent.id, tool: one.tool, target: one.target, ok: one.ok ?? null, ms: one.ms ?? null })))
    .sort((a, b) => a.at - b.at)
    .slice(-WEB_CAPS.activity)

  return {
    v: 1,
    now,
    session: { id: sessionId, cwd, startedAt: data.startedAt, model: shortModel(main?.model) },
    repo: isRepo ? { name: F.baseName(root.replace(/[\\/]+$/, '')), root, branch: git.branch, ahead: git.ahead, behind: git.behind, head: git.head } : null,
    goal: goal ? { headline: goal.headline, text: goal.text, at: goal.at, followUps: goal.followUps.map(one => ({ text: one.text, at: one.at })) } : null,
    needs: { tone: needs.tone, kind: needs.kind, text: needs.text, ...(needs.agentId ? { agentId: needs.agentId } : {}), ...(needs.path ? { path: needs.path } : {}) },
    summary: {
      // "2 of 4" names the step in progress; with none, the page counts the steps done itself (never "Step 0 of 5")
      step: active ? sum.step || null : null,
      stepText: active?.text ?? null,
      running: sum.running,
      waiting: sum.waiting,
      done: sum.done,
      failed: sum.failed,
      files: sum.files,
      added: sum.added,
      removed: sum.removed,
      minutes: goal ? sum.minutes : Math.max(0, Math.floor((now - data.startedAt) / 60_000)),
      tokens: totals.tokensIn + totals.tokensOut + totals.cacheRead,
      costUsd: usage?.costUsd ?? null,
      contextPercent: usage?.contextPercent ?? null,
    },
    plan: { source: plan.source, steps: plan.steps.map(step => ({ key: step.key, text: step.text, status: step.status, agents: [...step.agents] })) },
    agents: agents.map(agent => webAgentOf(data, agent, root, plan)),
    messages: data.messages.slice(-WEB_CAPS.messages).map(message => ({
      id: message.id,
      at: message.at,
      from: message.from,
      to: message.to,
      kind: message.kind,
      text: F.trunc(message.text, WEB_CAPS.messageChars),
    })),
    activity,
    files: M.filesOf(data).map(file => ({ path: file.path, editors: file.editors, live: file.live, isShared: file.isShared, added: file.added, removed: file.removed, lastAt: file.lastAt })),
    edits: data.edits.slice(-WEB_CAPS.edits).map(edit => ({ id: webIdOf(edit.id), agent: edit.agent, tool: edit.tool, path: edit.path, at: edit.at, added: edit.added, removed: edit.removed })),
    changes: isRepo ? git.files.map(file => ({ path: file.path, code: file.code, added: file.added, removed: file.removed, editors: editors.get(M.normPath(file.path)) ?? [] })) : [],
    commits: isRepo
      ? git.commits.slice(0, WEB_CAPS.commits).map(commit => ({
          hash: commit.hash,
          short: commit.short,
          subject: commit.subject,
          author: commit.author,
          at: commit.at,
          added: commit.added,
          removed: commit.removed,
          files: commit.files,
          agent: data.commitsBy[commit.hash] ?? null,
        }))
      : [],
  }
}

/** The patch files still to write: each edit once (`written` holds the ids written already), as `patches/<id>.diff` holds it. */
export function newPatchesOf(data: DeckData, written: ReadonlySet<string>): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = []
  for (const edit of data.edits.slice(-WEB_CAPS.edits)) {
    const id = webIdOf(edit.id)
    if (written.has(id)) continue
    out.push({ id, text: edit.patch.endsWith('\n') || edit.patch === '' ? edit.patch : `${edit.patch}\n` })
  }
  return out
}

// The server: how it is started, and what it prints back.

/** The page's address: the server's port on 127.0.0.1, the token as `t`. */
export function webUrlOf(port: number, token: string): string {
  return `http://127.0.0.1:${port}/?t=${encodeURIComponent(token)}`
}

/** The server's command line (no shell): node, web/server.js, its folder, the session's pid to outlive no longer, and the port to take again. */
export function serverArgvOf(script: string, dir: string, pid: string, port: number): string[] {
  return ['node', script, '--dir', dir, ...(pid ? ['--parent', pid] : []), ...(port > 0 ? ['--port', String(port)] : [])]
}

/** A line the server printed: its first, `{"ready":<port>}`, or a command from the page. */
export type ServerLine = { kind: 'ready'; port: number } | { kind: 'cmd'; cmd: Record<string, unknown> }

/** What a command from the page asks the mod to do, checked against the model. */
export type WebRoute = { kind: 'chat'; agentId: string; text: string } | { kind: 'review'; text: string } | { kind: 'ping' }

/** The most a line may grow without a newline before it is dropped: past any command the server passes (16 KB). */
const MOST_LINE = 65_536

/**
 * Cuts what the server wrote into whole lines: `rest`, the piece held since
 * the last chunk, then `chunk`. A line may span chunks and a chunk hold many;
 * the part after the last newline is held again. Blank lines are dropped,
 * a `\r` before the newline too.
 */
export function splitLines(rest: string, chunk: string): { lines: string[]; rest: string } {
  const parts = `${rest}${chunk}`.split('\n')
  const tail = parts.pop() ?? ''
  const lines = parts.map(line => line.replace(/\r$/, '')).filter(line => line.trim() !== '')
  return { lines, rest: tail.length > MOST_LINE ? '' : tail }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One line the server printed, read: the ready line, a command, or null for anything else (never a throw). */
export function parseLine(line: string): ServerLine | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  const port = value.ready
  if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65_536) return { kind: 'ready', port }
  if (typeof value.cmd === 'string') return { kind: 'cmd', cmd: value }
  return null
}

/** The agents a message from the page may go to: the Orchestrator, subagents and teammates. */
const CHATTY: readonly DeckAgent['kind'][] = ['main', 'agent', 'teammate']

/**
 * What a command asks, once it is checked against the model: a `chat` to an
 * agent the deck holds (the Orchestrator, a subagent, a teammate), a `review`
 * prompt, or a `ping`. Text must be a string, not blank, at most 4000
 * characters. Anything else is null, to be ignored.
 */
export function routeOf(cmd: unknown, data: DeckData): WebRoute | null {
  if (!isRecord(cmd)) return null
  if (cmd.cmd === 'ping') return { kind: 'ping' }
  const text = typeof cmd.text === 'string' ? cmd.text.trim() : ''
  if (text === '' || text.length > MOST_TEXT) return null
  if (cmd.cmd === 'review') return { kind: 'review', text }
  if (cmd.cmd !== 'chat' || typeof cmd.agentId !== 'string') return null
  const agent = M.agentOf(data, cmd.agentId)
  if (!agent || !CHATTY.includes(agent.kind)) return null
  return { kind: 'chat', agentId: agent.id, text }
}
