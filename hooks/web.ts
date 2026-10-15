/**
 * The web deck's half of the mod: what `.web/<sessionId>/state.json` holds
 * (`webStateOf`, the v1 `WebState` of web/CONTRACT.md), the patch and
 * message files written beside it, and the lines the server prints back
 * (`splitLines`, `parseLine`, `routeOf`, and the checks on an answer).
 *
 * Pure, like the model: nothing here reads a clock but the `now` it is
 * handed, and every query is model.ts's own, so the page and the pane say
 * the same thing. The hooks module (register.tsx) writes the files, starts
 * the server and acts on the commands.
 */
import type { DeckAgent, DeckData, DeckMessageKind, DeckPending, DeckStepStatus, DeckView } from '../types'
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
  /** What it waits on you for, as the words after its label: `asks: Which library?`, `needs your OK to run \`npm test\``. */
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
    /**
     * The files agents edited in the repository: `files[]` without `isOutside`
     * (all of them with no repository). `webStateOf` always writes it; a state
     * an earlier build wrote, or one made by hand, may leave it out: then it is
     * that count.
     */
    filesInRepo?: number
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
  messages: WebMessage[]
  /** The newest 150 tool calls of all agents, oldest first. */
  activity: { at: number; agent: string; tool: string; target: string; ok: boolean | null; ms: number | null }[]
  /** Every file agents edited: the repository's first, then those outside it (`isOutside`), each the one edited last first. */
  files: WebFile[]
  /** The newest 300, oldest first; each one's patch at /patch/<id>. */
  edits: { id: string; agent: string; tool: string; path: string; at: number; added: number; removed: number }[]
  /** Git's uncommitted files. */
  changes: { path: string; code: string; added: number; removed: number; editors: string[] }[]
  /** The newest 20, newest first. */
  commits: { hash: string; short: string; subject: string; author: string; at: number; added: number; removed: number; files: number; agent: string | null }[]
  /** The calls the engine holds on you now, oldest first: questions the deck may answer, permission prompts it shows. */
  pending: WebPending[]
  /** What came of the page's commands, by their `id`: the newest 50, oldest first. */
  acks: WebAck[]
}

export type WebFile = {
  /** Repository-relative, or absolute for a file outside the repository. */
  path: string
  editors: string[]
  live: boolean
  isShared: boolean
  added: number
  removed: number
  lastAt: number
  /** Not under the repository's root: its path stayed absolute when the deck made it repository-relative (a scratch or temp file). Never set with no repository. */
  isOutside?: true
}

export type WebMessage = {
  /** `[A-Za-z0-9_-]` only; a cut one's whole text at /message/<id>. */
  id: string
  at: number
  from: string
  to: string
  kind: DeckMessageKind
  text: string
  /** Its text was cut to 600 characters: the whole is at /message/<id>. */
  isCut?: true
  /** The id of the page's command that sent it: what came of it is the ack of that id. */
  ackId?: string
  /** A question's or a choice's call (the pending item's `id` while it is held). */
  callId?: string
}

export type WebPending = Omit<DeckPending, 'questions'> & {
  questions?: { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[] }[]
  /** True only for a question this mod instance can still answer from the deck (its race is live); false after a reload. */
  isAnswerable: boolean
}

export type WebAck = { id: string; ok: boolean; status: 'queued' | 'delivered' | 'answered' | 'failed'; text: string; at: number }

/** The contract's sizes. */
export const WEB_CAPS = { task: 2000, result: 4000, messages: 200, messageChars: 600, activity: 150, edits: 300, commits: 20, acks: 50 } as const

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

/**
 * `text` cut to `max` characters for the page, which reads it as markdown:
 * a cut inside an inline code span drops that span's start, so no lone
 * backtick shows ("A `ge…" reads "A…"). A cut fenced block is left to the
 * page, which closes it.
 */
export function cutMarkdown(text: string, max: number): string {
  const cut = F.trunc(text, max)
  if (cut === text) return cut
  const body = cut.slice(0, -1)
  const inline = body.replace(/```[\s\S]*?(?:```|$)/g, '')
  if ((inline.match(/`/g) ?? []).length % 2 === 0) return cut
  const at = body.lastIndexOf('`')
  if (at < 0 || body.slice(at).includes('\n') || body.slice(Math.max(0, at - 2), at + 1) === '```') return cut
  return `${body.slice(0, at).trimEnd()}…`
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

/**
 * What the engine waits on the person for, when it waits for this agent, as
 * the words after its label: `asks: Which library?`, `needs your OK to run
 * \`npm test\``; null otherwise.
 */
function needsYouOf(data: DeckData, agent: DeckAgent): string | null {
  return M.waitPhraseOf(data, agent.id) || null
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
  // "Asks: Which library?", "Needs your OK to run `npm test`"
  if (needsYou !== null) return M.waitLineOf(needsYou)
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
    result: cutMarkdown(agent.answer ?? '', WEB_CAPS.result),
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

/** A path that names its drive or the file system's root: `C:/…`, `/tmp/…`, `//server/…`. */
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/])/

/**
 * The files agents edited, as the page lists them: the repository's first,
 * then those outside it, each the one edited last first. A file is outside
 * (`isOutside`) when its path stayed absolute as the deck made it relative
 * to the repository's root `root` (paths are made relative to that root as
 * they are recorded, `M.relOf`); with no root ('') none is.
 */
function webFilesOf(data: DeckData, root: string): WebFile[] {
  const files: WebFile[] = M.filesOf(data).map(file => ({
    path: file.path,
    editors: file.editors,
    live: file.live,
    isShared: file.isShared,
    added: file.added,
    removed: file.removed,
    lastAt: file.lastAt,
    ...(root !== '' && ABSOLUTE.test(file.path) ? { isOutside: true as const } : {}),
  }))
  return [...files.filter(file => !file.isOutside), ...files.filter(file => file.isOutside)]
}

/** Who edited each path the deck shows, by its spelling for comparing. */
function editorsByPath(data: DeckData): Map<string, string[]> {
  const byPath = new Map<string, string[]>()
  for (const file of M.filesOf(data)) byPath.set(M.normPath(file.path), file.editors)
  return byPath
}

/** A message as the page reads it: its id file-safe, its text cut at 600 characters (`isCut` then), and the command or call it belongs to. */
function webMessageOf(message: DeckData['messages'][number]): WebMessage {
  const text = cutMarkdown(message.text, WEB_CAPS.messageChars)
  return {
    id: webIdOf(message.id),
    at: message.at,
    from: message.from,
    to: message.to,
    kind: message.kind,
    text,
    ...(text !== message.text ? { isCut: true as const } : {}),
    ...(message.ackId ? { ackId: message.ackId } : {}),
    ...(message.callId ? { callId: message.callId } : {}),
  }
}

/** A call held on you as the page reads it; `answerable` holds the calls the deck can still answer (their races live in this module). */
function webPendingOf(item: DeckPending, answerable: ReadonlySet<string>): WebPending {
  return {
    id: item.id,
    agentId: item.agentId,
    kind: item.kind,
    tool: item.tool,
    at: item.at,
    ...(item.questions ? { questions: item.questions.map(one => ({ question: one.question, header: one.header, multiSelect: one.multiSelect, options: one.options.map(option => ({ label: option.label, description: option.description })) })) } : {}),
    ...(item.command ? { command: item.command } : {}),
    ...(item.path ? { path: item.path } : {}),
    ...(item.description ? { description: item.description } : {}),
    isAnswerable: item.kind === 'question' && answerable.has(item.id),
  }
}

/**
 * The whole state the page reads, as web/CONTRACT.md (v1) lays it out, from
 * the deck's live model at `now`. `view` is the pane's and changes nothing
 * here: the page keeps its own. `answerable` holds the questions whose race
 * is live in this mod instance (none after a reload): only those the page
 * may answer.
 */
export function webStateOf(
  data: DeckData,
  view: DeckView,
  git: GitState,
  usage: UsageInfo | null,
  now: number,
  sessionId: string,
  cwd: string,
  answerable: ReadonlySet<string> = new Set(),
): WebState {
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
  const files = webFilesOf(data, root)

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
      filesInRepo: files.filter(file => !file.isOutside).length,
      added: sum.added,
      removed: sum.removed,
      minutes: goal ? sum.minutes : Math.max(0, Math.floor((now - data.startedAt) / 60_000)),
      tokens: totals.tokensIn + totals.tokensOut + totals.cacheRead,
      costUsd: usage?.costUsd ?? null,
      contextPercent: usage?.contextPercent ?? null,
    },
    plan: { source: plan.source, steps: plan.steps.map(step => ({ key: step.key, text: step.text, status: step.status, agents: [...step.agents] })) },
    agents: agents.map(agent => webAgentOf(data, agent, root, plan)),
    messages: data.messages.slice(-WEB_CAPS.messages).map(webMessageOf),
    activity,
    files,
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
    pending: data.pending.map(item => webPendingOf(item, answerable)),
    acks: data.acks.slice(-WEB_CAPS.acks).map(ack => ({ id: ack.id, ok: ack.ok, status: ack.status, text: ack.text, at: ack.at })),
  }
}

/**
 * The message files still to write: each message the page shows cut
 * (`isCut`) and not written yet (`isSaved`), once, as `messages/<id>.md`
 * holds it: its whole text, or as much of it as the deck kept. `message` is
 * the deck's own, for the hooks module to mark written.
 */
export function newMessageFilesOf(data: DeckData): { id: string; text: string; message: DeckData['messages'][number] }[] {
  return data.messages
    .slice(-WEB_CAPS.messages)
    .filter(message => message.isSaved !== true && Array.from(message.text).length > WEB_CAPS.messageChars)
    .map(message => ({ id: webIdOf(message.id), text: `${(message.full ?? message.text).trim()}\n`, message }))
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
export type WebRoute =
  | { kind: 'chat'; agentId: string; text: string }
  | { kind: 'review'; text: string }
  /** Answers to a question the engine holds a call on: by question text, a label, labels comma-joined, or words of your own. */
  | { kind: 'answer'; callId: string; answers: Record<string, string> }
  | { kind: 'ping' }

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

/** The most questions one AskUserQuestion call asks, and the longest question or answer an answer carries. */
const MOST_QUESTIONS = 4
const MOST_ANSWER = 2000

/** The `id` a command carries for its ack: `[A-Za-z0-9_-]{1,40}`; '' for none, or one of any other shape. */
export function cmdIdOf(cmd: unknown): string {
  return isRecord(cmd) && typeof cmd.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(cmd.id) ? cmd.id : ''
}

/** An answer command's answers: question text to a non-blank string, at most four, each at most 2000 characters (a blank one is a question left unanswered); null for any other shape or none. */
function answersOf(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null
  const entries = Object.entries(value)
  if (entries.length === 0 || entries.length > MOST_QUESTIONS) return null
  const out: Record<string, string> = {}
  for (const [question, answer] of entries) {
    if (typeof answer !== 'string' || question.length > MOST_ANSWER || answer.length > MOST_ANSWER) return null
    if (answer.trim() !== '') out[question] = answer.trim()
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * What a command asks, once it is checked against the model: a `chat` to an
 * agent the deck holds (the Orchestrator, a subagent, a teammate), a `review`
 * prompt, an `answer` to a question (its call and answers; whether that call
 * still waits is the hooks module's to tell), or a `ping`. Text must be a
 * string, not blank, at most 4000 characters. Anything else is null, to be
 * refused (`refusalOf` says why).
 */
export function routeOf(cmd: unknown, data: DeckData): WebRoute | null {
  if (!isRecord(cmd)) return null
  if (cmd.cmd === 'ping') return { kind: 'ping' }
  // an answer has no text of its own: it is read before the text is
  if (cmd.cmd === 'answer') {
    const answers = answersOf(cmd.answers)
    const callId = typeof cmd.callId === 'string' ? cmd.callId.trim() : ''
    return callId !== '' && callId.length <= 200 && answers ? { kind: 'answer', callId, answers } : null
  }
  const text = typeof cmd.text === 'string' ? cmd.text.trim() : ''
  if (text === '' || text.length > MOST_TEXT) return null
  if (cmd.cmd === 'review') return { kind: 'review', text }
  if (cmd.cmd !== 'chat' || typeof cmd.agentId !== 'string') return null
  const agent = M.agentOf(data, cmd.agentId)
  if (!agent || !CHATTY.includes(agent.kind)) return null
  return { kind: 'chat', agentId: agent.id, text }
}

/**
 * What the page's Review does once the prompt box answered its fill: done
 * (the request is in the box, for you to send); sent as your next prompt
 * where the session binds no box (`no_composer`: the Desktop app draws its
 * own composer); else refused, saying why. A refusal with no cause is not
 * taken to mean no box exists (a hook's own refusal carries none).
 */
export function reviewStepOf(filled: { isFilled: boolean; refusal?: 'no_composer' | 'dialog' } | undefined): { kind: 'filled' } | { kind: 'queue' } | { kind: 'failed'; why: string } {
  if (filled?.isFilled) return { kind: 'filled' }
  if (filled?.refusal === 'no_composer') return { kind: 'queue' }
  return { kind: 'failed', why: filled?.refusal === 'dialog' ? 'A dialog is open in Claude Code: answer it, then try again' : 'Could not fill the prompt box' }
}

/** Why `routeOf` refused a command, as its ack says it. */
export function refusalOf(cmd: unknown, data: DeckData): string {
  if (!isRecord(cmd) || typeof cmd.cmd !== 'string') return 'Not a command the deck reads'
  if (cmd.cmd === 'answer') return 'Not an answer the deck can read'
  if (cmd.cmd !== 'chat' && cmd.cmd !== 'review') return `Not a command the deck knows: ${F.trunc(F.oneLine(cmd.cmd), 40)}`
  const text = typeof cmd.text === 'string' ? cmd.text.trim() : ''
  if (text === '') return 'Nothing to send'
  if (text.length > MOST_TEXT) return `Too long: at most ${MOST_TEXT} characters`
  if (cmd.cmd === 'chat') {
    const agent = typeof cmd.agentId === 'string' ? M.agentOf(data, cmd.agentId) : undefined
    if (!agent) return 'No such agent in this session'
    if (!CHATTY.includes(agent.kind)) return 'Only the Orchestrator, its agents and teammates take messages from here'
  }
  return 'Not sent'
}

/**
 * Why answers cannot go to the held call `item`; '' when they can: it must
 * be a question still held, and each answer must be to one of its questions
 * (one of its labels, labels comma-joined for a multi-select one, or words
 * of your own, as its dialog's Other takes them).
 */
export function answerProblemOf(item: DeckPending | undefined, answers: Readonly<Record<string, string>>): string {
  if (!item || item.kind !== 'question') return 'No longer pending'
  const asked = new Set((item.questions ?? []).map(one => one.question))
  const stray = Object.keys(answers).find(question => !asked.has(question))
  return stray === undefined ? '' : `Not a question it asked: ${F.trunc(F.oneLine(stray), 60)}`
}

/**
 * The answers as the question's own dialog gives them: an option's label as
 * the option spells it, a multi-select's labels joined with ", ", words of
 * your own as typed. Questions left unanswered stay out.
 */
export function answersFor(item: DeckPending, answers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const one of item.questions ?? []) {
    const said = answers[one.question]
    if (said === undefined) continue
    const labelOf = (text: string) => one.options.find(option => option.label.trim().toLowerCase() === text.trim().toLowerCase())?.label
    if (!one.multiSelect) {
      out[one.question] = labelOf(said) ?? said
      continue
    }
    const labels = said.split(',').map(labelOf)
    out[one.question] = labels.every(label => label !== undefined) ? labels.join(', ') : said
  }
  return out
}
