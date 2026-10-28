/**
 * The web deck's half of the mod: what `.web/<sessionId>/state.json` holds
 * (`webStateOf`, the v1 `WebState` of web/CONTRACT.md, and beside it under
 * `v2` the one view model every surface draws, `deckStateOf`'s
 * `WebStateV2`), the patch, message and agent files written beside it, and
 * the lines the server prints back (`splitLines`, `parseLine`, `routeOf`,
 * and the checks on an answer).
 *
 * Pure, like the model: nothing here reads a clock but the `now` it is
 * handed, and every query is model.ts's own, so the page and the pane say
 * the same thing. The hooks module (register.tsx) writes the files, starts
 * the server and acts on the commands.
 */
import type { DeckAgent, DeckData, DeckMessage, DeckMessageKind, DeckPending, DeckQuestion, DeckStepStatus, DeckView, DeckView2 } from '../types'
import * as AV from '../web/avatars.mjs'
import * as B from './background'
import type { Hunk } from './diff'
import * as F from './format'
import type { GitState } from './git'
import * as M from './model'
import { othersLineOf, type SessionsV2 } from './sessions'
import { timelineOf, type V2Timeline } from './timeline'
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
  /** Delivered to its agent (a send from the deck, a SendMessage); absent when no one said. */
  isDelivered?: boolean
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

/** An agent's avatar colours, 0 to 9 (web/avatars.mjs `paletteIndexOf`): the same id, the same colours, in every write and session. */
export function avatarOf(id: string): number {
  return AV.paletteIndexOf({ id })
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
  return M.shownStatusOf(agent, data)
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

/**
 * A message as the page reads it: its id file-safe, its text cut at 600
 * characters (`isCut` then), whether it was delivered, and the command or
 * call it belongs to. v1 reads an agent's words to nobody in particular (its
 * words after your message, `to` '') as to you, as it always has: v2 says
 * whom they went to (`deckStateOf`'s chat rows: `to` null).
 */
function webMessageOf(message: DeckData['messages'][number]): WebMessage {
  const text = cutMarkdown(message.text, WEB_CAPS.messageChars)
  return {
    id: webIdOf(message.id),
    at: message.at,
    from: message.from,
    to: message.to === '' ? M.YOU : message.to,
    kind: message.kind,
    text,
    ...(text !== message.text ? { isCut: true as const } : {}),
    ...(message.isDelivered !== undefined ? { isDelivered: message.isDelivered } : {}),
    ...(message.ackId ? { ackId: message.ackId } : {}),
    ...(message.callId ? { callId: message.callId } : {}),
  }
}

/** The message kinds v1's page and pane know: Claude Code's notifications (to you, and of a task to the main loop) are v2's alone. */
const V1_KINDS: ReadonlySet<DeckMessageKind> = new Set(['prompt', 'spawn', 'result', 'message', 'chat', 'answer', 'question', 'choice'])

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
    messages: data.messages
      .filter(message => V1_KINDS.has(message.kind))
      .slice(-WEB_CAPS.messages)
      .map(webMessageOf),
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

// ---------------------------------------------------------------------------
// v2: the one view model the web page, the Desktop pane and the terminal all
// draw (web/CONTRACT.md, v2). Only what Claude Code did, said or holds: no
// plan it did not make, no step links, no addressee it did not use, no need
// it did not raise. Its derived wording (a row's title, a chat row's
// sentence head, a fold's counts, the header's word) is made here once.

/** A row's dot: `starting` until the engine spawns the agent its Agent call asked for; `waiting` only while something waits on you. */
export type V2Status = 'starting' | 'running' | 'waiting' | 'done' | 'failed' | 'idle'

export type V2Header = {
  /** Something in `needs` waits on you; else the main loop or an agent is at work; else idle. */
  state: 'working' | 'waiting' | 'idle'
  /** That word as every surface prints it: "Working", "Waiting on you", "Idle". */
  stateText: string
  /**
   * Your latest request, in your words: the newest prompt you typed (or
   * sent from the deck) to the Orchestrator, else the goal the transcript
   * held; null before the first. `messageId` names its chat row when it is
   * one (its whole text at /message/<id> when `isCut`).
   */
  goal: { text: string; headline: string; at: number; isCut?: true; messageId?: string } | null
  /** Short: `opus-5.5`; '' until known. */
  model: string
  contextPercent: number | null
  costUsd: number | null
  /** "opus-5.5 · context 41% · $4.12", each part left out while unknown. */
  line: string
  /** The main loop's running turn, the one `abortTurn` ends (`$.turn.abort`), and when it started (null when the deck did not see it start); null between turns. */
  turn: { id: string; at: number | null } | null
}

export type V2Question = { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[] }

/** One thing that needs you: only what Claude Code itself raised (a question, a permission prompt, its notification). */
export type V2Need = {
  /** A question's or a permission prompt's call (its tool_use_id, `webIdOf`'d), which `answer` names; a notification's own id. `[A-Za-z0-9_-]`. */
  id: string
  /** `question`: AskUserQuestion, answerable from the deck while `isAnswerable`; `permission`: its dialog shows (a tool.check ask, then its PermissionRequest); `notification`: Claude Code's own (classic Notification). */
  kind: 'question' | 'permission' | 'notification'
  /** Whose: `main`, or an agent's id. */
  agent: string
  /** Its row's title in `agents` ("Orchestrator" for the main loop). */
  agentName: string
  at: number
  /** How old, coarse: "now", "3m", "2h". */
  age: string
  /** A question's questions, one paragraph each; a permission's description (else its tool); a notification's words, verbatim. */
  text: string
  /** A question's, as its call gave them. */
  questions?: V2Question[]
  /** True only for a question this mod instance can still answer (its race is live); false after a reload, and for every other kind. */
  isAnswerable: boolean
  /** A permission's tool. */
  tool?: string
  /** A permission's exact shell command (at most 2000 characters, may span lines). */
  command?: string
  /** A permission's file, repository-relative inside the repository. */
  path?: string
  /** A permission's own words for what it does, else what it is aimed at. */
  description?: string
  /** A notification's own type (`permission_prompt`, `idle_prompt`, one the deck does not know) and title, verbatim. */
  type?: string
  title?: string
}

/** One agent in the tree of who started whom. */
export type V2AgentRow = {
  row: 'agent'
  /** `main` is the Orchestrator. */
  id: string
  /** Its agent file's name, `id` file-safe (`webIdOf`): agents/<fileId>.json, served at /agent/<fileId>. */
  fileId: string
  /** Who started it: `main`, or an agent's id; null for the Orchestrator. */
  parent: string | null
  /** 0 for the Orchestrator, 1 for the agents it started, and so on. */
  depth: number
  /** The Orchestrator; an Agent call's agent; a teammate; a Workflow script's agent; or a loop of Claude Code's own with no spawn (a compaction, a memory fork). */
  kind: 'orchestrator' | 'agent' | 'teammate' | 'workflow' | 'engine'
  status: V2Status
  /** Stopped (TaskStop, or its turn aborted), not failed: its status says `failed`. */
  isStopped: boolean
  /** The name its spawn gave it; '' with none. */
  name: string
  /** Its Agent call's description, on one line; '' with none. */
  description: string
  /** Its agent type (`Explore`, `general-purpose`); '' when Claude Code did not say. */
  type: string
  /** The start of its id ('' for the Orchestrator and a placeholder): told apart from a namesake. */
  shortId: string
  /** What its row leads with: its name, else its description (cut after a word, 60 characters), else its type, else its short id; "Orchestrator" for the main loop. Never a made-up name or a " 2". */
  title: string
  /** Its call in flight, verbatim: the tool and what it was given (a shell's command, a file, a pattern); null between calls. */
  live: { tool: string; text: string; at: number } | null
  startedAt: number
  endedAt: number | null
  /** When a message last woke it, finished or idle (a SendMessage resuming it): the same agent, no new spawn; null for one never resumed. */
  resumedAt: number | null
  /** How long it has been at it, coarse ("<1m", "4m"), or how long its run took (a resumed one's since it was woken); the Orchestrator's: its turn's, '' between turns. */
  elapsed: string
  /** Its spawn ran it in the background (every teammate's does): only such an agent can be stopped (`stopAgent`). */
  background: boolean
  /** Short: `haiku-4.5`; '' until known. */
  model: string
  /** 0–9, stable per agent. */
  avatar: number
  /** How many of `needs` are its. */
  needs: number
  /** The fold group it sits in (a `V2FoldRow`'s id: it is drawn only while that is open); null on a row always drawn. */
  fold: string | null
  /** The prompt it was given, at most 600 characters (`isTaskCut`: the whole in its agent file); '' for the Orchestrator, whose task is your request. */
  task: string
  isTaskCut?: true
  /** What it handed back (its hand-back, its answer, its last message); the Orchestrator's: its latest answer to you. At most 600 characters (`isResultCut`: the whole in its agent file). '' until it reports. */
  result: string
  isResultCut?: true
  /** Its own TodoWrite list, with Claude's statuses. */
  todos: V2Todo[]
  /** In + out + cache reads. */
  tokens: number
  /** Hidden by the deck's "Clear finished" (`clearedStateOf`): left out of the Dashboard, Chat's members and Everyone, and Org; still on its page, in Changes and Inspect. Never anything in Claude Code. */
  isCleared?: true
  /**
   * While it is at work: its Stop (`stopAgent`, Claude Code's TaskStop), shown
   * only where `can` (a background agent or a teammate whose TaskStop Claude
   * Code's permission check allows), else why not in one line (the
   * Orchestrator's while its turn runs: Stop turn ends it). Absent otherwise.
   */
  stop?: B.V2Stop
}

/** A TodoWrite item, or a board task's words, with Claude's own status: `doing` its activeForm. */
export type V2Todo = { text: string; status: 'done' | 'active' | 'pending'; doing?: string }

/** The agents one parent started that finished or went idle, folded into one row the way Claude Code's own panel folds them. */
export type V2FoldRow = {
  row: 'fold'
  /** `fold:` and its parent's id. */
  id: string
  parent: string
  /** Its members' depth. */
  depth: number
  /** The agents it folds that its parent started, in spawn order (the agents they started fold with them). */
  ids: string[]
  done: number
  failed: number
  stopped: number
  idle: number
  /** "4 done · 1 failed". */
  text: string
}

export type V2Row = V2AgentRow | V2FoldRow

/** One message of the one chat, read as a sentence: `who` then `text`. */
export type V2ChatRow = {
  /** `[A-Za-z0-9_-]`: a cut one's whole text at /message/<id>. */
  id: string
  at: number
  /** `you`, `main`, an agent's id, `engine` (Claude Code itself), or the name a sender went by that no agent of the session carries. */
  from: string
  /** `you`, `main`, an agent's id, or the name SendMessage was given that no agent carries; null when the words went to nobody in particular (an agent's words after your message). */
  to: string | null
  /** The sentence's head: "You → Orchestrator", "Orchestrator → scout", "scout", "Claude Code → you". */
  who: string
  kind: DeckMessageKind
  /** A SendMessage's own summary; a notification's title, else its type; a task notification's status. */
  title?: string
  /** At most 600 characters, Markdown. */
  text: string
  isCut?: true
  /** Delivered to its agent (a send from the deck, a SendMessage); absent when no one said. */
  isDelivered?: boolean
  /** The id of the page's command that sent it: its outcome is the ack of that id. */
  ackId?: string
  /** A question's or a choice's call, `webIdOf`'d (the need's `id` while it is held). */
  callId?: string
  /** The agent a notification is about. */
  agent?: string
  /** From, to or about an agent "Clear finished" hid: left out of Chat's Everyone and Between agents. */
  isCleared?: true
}

/** The plan, only as Claude made it, from every source it used; null when it made none. */
export type V2Plan = {
  /** Its task board (TaskCreate, TaskUpdate), by task id, with Claude's statuses and the owner TaskUpdate named. */
  board: { id: string; subject: string; status: 'pending' | 'active' | 'done'; owner: string | null; doing?: string }[]
  /** The Orchestrator's own TodoWrite list, with Claude's statuses; null for none. */
  todos: { items: V2Todo[]; at: number } | null
  /** The plan approved last (ExitPlanMode), as Claude wrote it: Markdown, never split into steps; null for none. */
  approved: { markdown: string; at: number; by: string } | null
  /** Each Workflow run's phases, as its script's meta names them: no phase has a status (no event says one). */
  workflows: { id: string; name: string; phases: string[]; startedAt: number; endedAt: number | null }[]
}

export type V2Changes = {
  repo: WebState['repo']
  /**
   * Git's uncommitted files; `edits` the ids of the agents' own edits of that
   * path (patches at /patch/<id>). `diffId` names git's own diff of the file
   * (gitdiffs/<id>.diff, at /gitdiff/<id>): null until the mod has read it
   * (it reads them while the web deck is on), and for a binary file or one
   * past 200,000 characters. Git's hunks are never tagged by agent.
   */
  files: { path: string; code: string; added: number; removed: number; edits: string[]; diffId: string | null }[]
  /** Each agent's own edit patches, the newest 300, oldest first. */
  edits: { id: string; agent: string; tool: string; path: string; at: number; added: number; removed: number; isOutside?: true }[]
  /** The newest 20, newest first; `agent` the one whose shell call made it. */
  commits: WebState['commits']
}

/** Inspect's first part (Phase 2 adds context, loaded, permissions and background): the context, the spend, and each agent's tokens. */
export type V2Inspect = {
  contextPercent: number | null
  costUsd: number | null
  agents: { id: string; title: string; model: string; tokens: { in: number; out: number; cacheRead: number }; requests: number; tools: number; errors: number }[]
}

/** One tool call of any agent's, as Now's Recent activity lists it. */
export type V2Activity = {
  /** The call's tool_use_id, `webIdOf`'d. */
  id: string
  /** When it started. */
  at: number
  /** Whose: `main`, or an agent's id. */
  agent: string
  /** Its row's title in `agents` ("Orchestrator" for the main loop), cut after a word at 40 characters. */
  agentName: string
  tool: string
  /** The call's own description (a shell call's), else what it was aimed at (a file, a pattern, a URL, a question), verbatim as the deck kept it. */
  text: string
  /** How it went; null while it runs (and for one whose end never came). */
  ok: boolean | null
  /** How long it took; null until it ends. */
  ms: number | null
}

/** One file the agents edited, as Now's Files lists it: who edited it and how much, nothing read into it. */
export type V2File = {
  /** Repository-relative, or absolute for a file outside the repository (`isOutside`). */
  path: string
  /** The agents that edited it (`main` or an agent's id), in the order of their first edit of it. */
  editors: string[]
  /** All its edits' lines added and removed. */
  added: number
  removed: number
  /** When it was edited last. */
  lastAt: number
  /** Not under the repository's root: its path stayed absolute (a scratch or temp file). Never set with no repository. */
  isOutside?: true
}

/** The figures strip of Now: counts of what is in the state, the plan's only from Claude's own lists, and the spend. */
export type V2Figures = {
  /** The agent rows, but the Orchestrator's and Claude Code's own loops: starting or running, waiting on you, done, failed (not stopped), and stopped. An idle one counts for none. */
  running: number
  waiting: number
  done: number
  failed: number
  stopped: number
  /** Claude's task board's tasks done of all; with no board, the Orchestrator's TodoWrite items done of all; null with neither (an approved plan or a Workflow's phases have no statuses to count). */
  plan: { done: number; total: number } | null
  costUsd: number | null
  /** Every agent's tokens (the Orchestrator's too): in + out + cache reads. */
  tokens: number
  contextPercent: number | null
  /** Whole minutes since the goal began, to `now` while work goes on, else to its last news; with no goal, since the session started. */
  minutes: number
  /** How many things need you: `needs`' length. */
  needs: number
}

/** The state every surface draws (web/CONTRACT.md, v2). */
export type WebStateV2 = {
  v: 2
  /** When it was built, ms since the epoch. */
  now: number
  session: { id: string; cwd: string; startedAt: number }
  /** The style the deck draws agents' avatars in (web/avatars.mjs): the person's setting, robots by default. */
  avatarStyle: AV.AvatarStyle
  header: V2Header
  /** What needs you, oldest first; empty when nothing does. */
  needs: V2Need[]
  /** The tree of who started whom, as rows: the Orchestrator first, each agent under the one that started it (spawn order), the ones at work first and then their parent's fold row and its members. */
  agents: V2Row[]
  /** What runs when no agent is talking (hooks/background.ts): background shells, monitors, workflows, crons and wakeups; empty rows when none. */
  background: B.V2Background
  /** Every agent's latest tool calls (the newest 14 of each the deck keeps), the newest 40 of them, newest first. */
  activity: V2Activity[]
  /** Every file the agents edited: the repository's first, then those outside it, each list the one edited last first. */
  files: V2File[]
  figures: V2Figures
  plan: V2Plan | null
  /** The newest 200 messages, oldest first. */
  chat: V2ChatRow[]
  changes: V2Changes
  inspect: V2Inspect
  /** What came of the page's commands, by their `id`: the newest 50, oldest first. */
  acks: WebAck[]
  /** The agents "Clear finished" hid (their rows `isCleared`), how many, and when it was pressed last; 0 and null when none are. "Show N cleared" brings them back. */
  cleared: { count: number; at: number | null }
  /** Every session on this machine (./sessions, "All sessions"), this chat first; absent until the registry was read (and in another session's state as a deck shows it). */
  sessions?: SessionsV2
}

/** An agent's own file, `agents/<id>.json`, read when its page opens: its words whole and its calls. */
export type V2AgentFile = {
  v: 2
  id: string
  /** The prompt it was given, whole as kept (at most 2000 characters). */
  task: string
  /** What it handed back, whole as kept (at most 4000 characters). */
  result: string
  todos: V2Todo[]
  /** Its latest tool calls (the newest 14 the deck keeps), oldest first: what each was given, verbatim, and how it went. */
  activity: { id: string; at: number; tool: string; target: string; command?: string; description?: string; ok: boolean | null; ms: number | null }[]
  /** Its edits' ids, oldest first: each patch at /patch/<id>. */
  edits: string[]
}

/** v2's sizes: the chat rows kept, a text's characters in the state, the edits, commits and acks kept, a title's and a name's characters, the tool calls in `activity`. */
export const V2_CAPS = { chat: 200, text: 600, edits: 300, commits: 20, acks: 50, title: 60, name: 40, activity: 40 } as const

const STATE_TEXT: Readonly<Record<V2Header['state'], string>> = { working: 'Working', waiting: 'Waiting on you', idle: 'Idle' }


/** The loops that are rows of the tree: the Orchestrator, its agents (a Workflow's and Claude Code's own among them) and teammates; never you or a peer of earlier builds. */
function isTreeAgent(agent: DeckAgent): boolean {
  return agent.kind === 'main' || agent.kind === 'agent' || agent.kind === 'teammate'
}

/** The kind of loop a row is. */
function rowKindOf(agent: DeckAgent): V2AgentRow['kind'] {
  if (agent.kind === 'main') return 'orchestrator'
  if (agent.origin === 'workflow') return 'workflow'
  if (agent.origin === 'engine') return 'engine'
  return agent.kind === 'teammate' ? 'teammate' : 'agent'
}

/** The start of an agent's id, to tell it from a namesake; '' for the Orchestrator and a row its Agent call made before the spawn. */
function shortIdOf(agent: DeckAgent): string {
  if (agent.kind === 'main' || M.isPlaceholder(agent)) return ''
  return agent.id.slice(0, 7)
}

/** Its type as Claude Code said it; '' for the deck's own placeholder word. */
function typeOf(agent: DeckAgent): string {
  if (agent.kind === 'main') return ''
  const type = agent.type.trim()
  return type === 'subagent' || type === 'agent' || type === 'teammate' ? '' : type
}

/** What a row leads with: its name, else its description, else its type, else its short id; the Orchestrator for the main loop. */
export function rowTitleOf(agent: DeckAgent): string {
  if (agent.kind === 'main') return M.ORCHESTRATOR
  if (!M.isNameless(agent)) return F.oneLine(agent.name)
  const description = F.oneLine(agent.description)
  if (description !== '') return M.cutAtWord(description, V2_CAPS.title)
  return typeOf(agent) || shortIdOf(agent) || agent.id.slice(0, 7)
}

/** A sender or a receiver as a chat row's sentence names it: You (you once named second), the Orchestrator, Claude Code, an agent's title, or the name itself. */
function partyOf(data: DeckData, id: string, isSender: boolean): string {
  if (id === M.YOU) return isSender ? 'You' : 'you'
  if (id === M.MAIN) return M.ORCHESTRATOR
  if (id === M.ENGINE) return M.ENGINE_NAME
  const agent = M.agentOf(data, id)
  return agent && agent.kind !== 'peer' ? M.cutAtWord(rowTitleOf(agent), V2_CAPS.name) : id.replace(/^peer:/, '')
}

/** A text cut for the state (`cutMarkdown`) and whether it was. */
function cutOf(text: string, most: number): { text: string; isCut: boolean } {
  const cut = cutMarkdown(text, most)
  return { text: cut, isCut: cut !== text }
}

/** The call in flight, verbatim: a shell's command, else what it was aimed at. */
function liveOf(agent: DeckAgent): V2AgentRow['live'] {
  const call = agent.current
  if (!call) return null
  return { tool: call.tool, text: F.oneLine(call.command || call.target), at: call.at }
}

/** A TodoWrite list (or board items) as the state carries it. */
function todosOf(items: readonly { text: string; status: V2Todo['status']; doing?: string }[] | undefined): V2Todo[] {
  return (items ?? []).map(item => ({ text: item.text, status: item.status, ...(item.doing ? { doing: item.doing } : {}) }))
}

/** What an agent handed back, as Claude Code gave it ('' until it reports). */
function resultOf(agent: DeckAgent): string {
  return agent.answer ?? ''
}

/** Whether a row folds: finished or idle, nothing of its waits on you. */
function isQuietRow(row: V2AgentRow): boolean {
  return row.kind !== 'orchestrator' && row.needs === 0 && (row.status === 'done' || row.status === 'failed' || row.status === 'idle')
}

/** Whether an agent is finished: done, failed, stopped or idle, nothing of its waiting on you; never the Orchestrator. The Dashboard and Chat's members fold these behind one "N finished" row. */
export function isFinishedRow(row: V2AgentRow): boolean {
  return isQuietRow(row)
}

/** When an agent's run ended (else its last wake, else its start): what "Clear finished" weighs against when it was pressed. */
function runEndOf(row: V2AgentRow): number {
  return row.endedAt ?? row.resumedAt ?? row.startedAt
}

/** What "Clear finished" hid: the agents' ids, and when it was pressed last (0 for never). The deck's view keeps it (`DeckView2.cleared`, `clearedAt`). */
export type Cleared = { ids: readonly string[]; at: number }

/** Nothing cleared. */
export const NONE_CLEARED: Cleared = { ids: [], at: 0 }

/**
 * The state with what "Clear finished" hid marked, for every surface to
 * leave out of the Dashboard, Chat's members and Everyone, and Org: an
 * agent it named that is finished (`isFinishedRow`), ended no later than
 * the press, and has nothing under it still shown. One that runs again
 * shows again. Their chat rows (from, to or about one) are marked too; the
 * fold rows count only the agents still shown; `cleared` says how many.
 * Nothing leaves the state: an agent's page, Changes and Inspect keep them.
 */
export function clearedStateOf(state: WebStateV2, cleared: Cleared): WebStateV2 {
  const named = new Set(cleared.ids)
  const rows = state.agents.filter((row): row is V2AgentRow => row.row === 'agent')
  if (named.size === 0 || !rows.some(row => named.has(row.id))) return { ...state, cleared: { count: 0, at: named.size > 0 && cleared.at > 0 ? cleared.at : null } }
  const kids = new Map<string, V2AgentRow[]>()
  for (const row of rows) if (row.parent !== null) kids.set(row.parent, [...(kids.get(row.parent) ?? []), row])
  const hidden = new Map<string, boolean>()
  const isHidden = (row: V2AgentRow, seen: Set<string>): boolean => {
    const known = hidden.get(row.id)
    if (known !== undefined) return known
    if (seen.has(row.id)) return false
    seen.add(row.id)
    const is = named.has(row.id) && isFinishedRow(row) && runEndOf(row) <= cleared.at && (kids.get(row.id) ?? []).every(kid => isHidden(kid, seen))
    hidden.set(row.id, is)
    return is
  }
  const gone = new Set(rows.filter(row => isHidden(row, new Set())).map(row => row.id))
  const agents: V2Row[] = []
  for (const row of state.agents) {
    if (row.row === 'agent') {
      agents.push(gone.has(row.id) ? { ...row, isCleared: true } : row)
      continue
    }
    // a fold row counts the agents it still shows; one with none left goes
    const ids = row.ids.filter(id => !gone.has(id))
    if (ids.length === 0) continue
    const counts = { done: 0, failed: 0, stopped: 0, idle: 0 }
    for (const id of ids) {
      const one = rows.find(each => each.id === id)
      if (!one) continue
      if (one.isStopped) counts.stopped += 1
      else if (one.status === 'failed') counts.failed += 1
      else if (one.status === 'idle') counts.idle += 1
      else counts.done += 1
    }
    agents.push({ ...row, ids, ...counts, text: foldTextOf(counts) })
  }
  const chat = state.chat.map(row => (gone.has(row.from) || (row.to !== null && gone.has(row.to)) || (row.agent !== undefined && gone.has(row.agent)) ? { ...row, isCleared: true as const } : row))
  return { ...state, agents, chat, cleared: { count: gone.size, at: cleared.at > 0 ? cleared.at : null } }
}

/** The state as the Dashboard, Chat's members and Org draw it: the agents "Clear finished" hid left out. */
export function shownStateOf(state: WebStateV2): WebStateV2 {
  if (!state.agents.some(row => row.row === 'agent' && row.isCleared)) return state
  return { ...state, agents: state.agents.filter(row => row.row !== 'agent' || !row.isCleared) }
}

/** The finished agents "Clear finished" would hide now: those shown that are finished (`isFinishedRow`). */
export function finishedIdsOf(state: Pick<WebStateV2, 'agents'>): string[] {
  return state.agents.filter((row): row is V2AgentRow => row.row === 'agent' && !row.isCleared && isFinishedRow(row)).map(row => row.id)
}

/** One agent's row, out of the tree: its `depth` and `fold` are the walk's to set. */
function agentRowOf(data: DeckData, agent: DeckAgent, now: number, needs: ReadonlyMap<string, number>): V2AgentRow {
  const isMain = agent.kind === 'main'
  const task = cutOf(isMain ? '' : agent.prompt, V2_CAPS.text)
  const result = cutOf(resultOf(agent), V2_CAPS.text)
  const turnAt = data.mainTurnAt
  return {
    row: 'agent',
    id: agent.id,
    fileId: webIdOf(agent.id),
    parent: isMain ? null : (M.parentIdOf(data, agent) ?? M.MAIN),
    depth: 0,
    kind: rowKindOf(agent),
    status: agent.status === 'starting' ? 'starting' : M.shownStatusOf(agent, data),
    isStopped: agent.status === 'killed',
    name: isMain || M.isNameless(agent) ? '' : F.oneLine(agent.name),
    description: isMain ? '' : F.oneLine(agent.description),
    type: typeOf(agent),
    shortId: shortIdOf(agent),
    title: rowTitleOf(agent),
    live: liveOf(agent),
    startedAt: agent.startedAt,
    endedAt: agent.endedAt ?? null,
    resumedAt: isMain ? null : (agent.resumedAt ?? null),
    elapsed: isMain ? (data.mainTurnId !== undefined && turnAt !== undefined ? M.elapsedOf({ ...agent, startedAt: turnAt, endedAt: undefined }, now) : '') : M.elapsedOf(agent, now),
    background: agent.kind === 'teammate' || agent.background === true,
    model: shortModel(agent.model),
    avatar: avatarOf(agent.id),
    needs: needs.get(agent.id) ?? 0,
    fold: null,
    task: task.text,
    ...(task.isCut ? { isTaskCut: true as const } : {}),
    result: result.text,
    ...(result.isCut ? { isResultCut: true as const } : {}),
    todos: todosOf(agent.todos),
    tokens: agent.tokensIn + agent.tokensOut + agent.cacheRead,
  }
}

/** "4 done · 1 failed": the counts a fold row says, each left out at none. */
function foldTextOf(fold: Pick<V2FoldRow, 'done' | 'failed' | 'stopped' | 'idle'>): string {
  const parts = [fold.done > 0 ? `${fold.done} done` : '', fold.failed > 0 ? `${fold.failed} failed` : '', fold.stopped > 0 ? `${fold.stopped} stopped` : '', fold.idle > 0 ? `${fold.idle} idle` : '']
  return parts.filter(part => part !== '').join(' · ')
}

/**
 * The tree of who started whom, as rows (depth-first, each parent's agents
 * in spawn order): the Orchestrator first; under each agent, the ones it
 * started that are at work, wait on you or have one of theirs at work; then
 * one fold row for the rest, the finished and idle ones, and their rows
 * (each with `fold` set, the agents they started with them). The
 * Orchestrator never folds. You and the peers of earlier builds are no rows.
 * `needs` counts each agent's needs (`needsListOf`): an agent with one never
 * folds.
 */
export function agentRowsOf(data: DeckData, now: number, needs: ReadonlyMap<string, number> = new Map()): V2Row[] {
  const main = M.agentOf(data, M.MAIN)
  if (!main) return []
  const workers = data.agents.filter(agent => isTreeAgent(agent) && agent.kind !== 'main')
  const kids = new Map<string, DeckAgent[]>()
  for (const agent of workers) {
    const parent = M.parentIdOf(data, agent) ?? M.MAIN
    kids.set(parent, [...(kids.get(parent) ?? []), agent])
  }
  const built = new Map<string, V2AgentRow>()
  const rowOf = (agent: DeckAgent): V2AgentRow => {
    const known = built.get(agent.id)
    if (known) return known
    const row = agentRowOf(data, agent, now, needs)
    built.set(agent.id, row)
    return row
  }
  // whether anything under an agent is at work or waits on you: then it stays out of the fold
  const busy = new Map<string, boolean>()
  const isBusyBelow = (id: string, seen: Set<string>): boolean => {
    const known = busy.get(id)
    if (known !== undefined) return known
    if (seen.has(id)) return false
    seen.add(id)
    const isBusy = (kids.get(id) ?? []).some(kid => !isQuietRow(rowOf(kid)) || isBusyBelow(kid.id, seen))
    busy.set(id, isBusy)
    return isBusy
  }
  const rows: V2Row[] = []
  const placed = new Set<string>()
  const walk = (agent: DeckAgent, depth: number, fold: string | null) => {
    if (placed.has(agent.id)) return
    placed.add(agent.id)
    rows.push({ ...rowOf(agent), depth, fold })
    const under = (kids.get(agent.id) ?? []).filter(kid => !placed.has(kid.id))
    if (fold !== null) {
      for (const kid of under) walk(kid, depth + 1, fold)
      return
    }
    const quiet = under.filter(kid => isQuietRow(rowOf(kid)) && !isBusyBelow(kid.id, new Set()))
    for (const kid of under) if (!quiet.includes(kid)) walk(kid, depth + 1, null)
    if (quiet.length === 0) return
    const id = `fold:${agent.id}`
    const counts = { done: 0, failed: 0, stopped: 0, idle: 0 }
    for (const kid of quiet) {
      const row = rowOf(kid)
      if (row.isStopped) counts.stopped += 1
      else if (row.status === 'failed') counts.failed += 1
      else if (row.status === 'idle') counts.idle += 1
      else counts.done += 1
    }
    rows.push({ row: 'fold', id, parent: agent.id, depth: depth + 1, ids: quiet.map(kid => kid.id), ...counts, text: foldTextOf(counts) })
    for (const kid of quiet) walk(kid, depth + 1, id)
  }
  walk(main, 0, null)
  // an agent the walk never reached (its parents name each other): under the Orchestrator, never lost
  for (const agent of workers) if (!placed.has(agent.id)) walk(agent, 1, null)
  return rows
}

/** A question's questions as the state carries them. */
function questionsOf(questions: readonly DeckQuestion[] | undefined): V2Question[] {
  return (questions ?? []).map(one => ({ question: one.question, header: one.header, multiSelect: one.multiSelect, options: one.options.map(option => ({ label: option.label, description: option.description })) }))
}

/**
 * What needs you, oldest first, only from what Claude Code raised: each call
 * it holds on you (a question, a permission prompt whose dialog shows), then
 * each of its notifications that asks something, its words verbatim. A
 * notification about a call held already (its permission prompt's, by its
 * call or its agent) is that call's need, not a second one.
 */
export function needsListOf(data: DeckData, now: number, answerable: ReadonlySet<string> = new Set()): V2Need[] {
  const nameOf = (id: string) => partyOf(data, id, true)
  const held: V2Need[] = data.pending.map(item => ({
    id: webIdOf(item.id),
    kind: item.kind,
    agent: item.agentId,
    agentName: nameOf(item.agentId),
    at: item.at,
    age: F.since(now - item.at),
    text: item.kind === 'question' ? M.questionsTextOf(item.questions ?? []) : item.description || item.tool,
    ...(item.kind === 'question' ? { questions: questionsOf(item.questions) } : {}),
    isAnswerable: item.kind === 'question' && answerable.has(item.id),
    ...(item.kind === 'permission' ? { tool: item.tool } : {}),
    ...(item.command ? { command: item.command } : {}),
    ...(item.path ? { path: item.path } : {}),
    ...(item.description ? { description: item.description } : {}),
  }))
  const notes: V2Need[] = []
  for (const note of data.needs) {
    const agent = note.agent ?? M.MAIN
    if (note.call !== undefined && data.pending.some(item => item.id === note.call)) continue
    if (note.kind === 'permission_prompt' && data.pending.some(item => item.kind === 'permission' && item.agentId === agent)) continue
    notes.push({
      id: webIdOf(`note_${note.at}_${note.kind}_${agent}`),
      kind: 'notification',
      agent,
      agentName: nameOf(agent),
      at: note.at,
      age: F.since(now - note.at),
      text: note.text,
      isAnswerable: false,
      type: note.kind,
      ...(note.title ? { title: note.title } : {}),
    })
  }
  return [...held, ...notes].sort((a, b) => a.at - b.at)
}

/** One message as a chat row: a sentence's head, its words cut at 600 characters, and what it belongs to. */
function chatRowOf(data: DeckData, message: DeckMessage): V2ChatRow {
  const text = cutOf(message.text, V2_CAPS.text)
  const to = message.to === '' ? null : message.to
  const from = partyOf(data, message.from, true)
  return {
    id: webIdOf(message.id),
    at: message.at,
    from: message.from,
    to,
    who: to === null ? from : `${from} → ${partyOf(data, to, false)}`,
    kind: message.kind,
    ...(message.title ? { title: message.title } : {}),
    text: text.text,
    ...(text.isCut ? { isCut: true as const } : {}),
    ...(message.isDelivered !== undefined ? { isDelivered: message.isDelivered } : {}),
    ...(message.ackId ? { ackId: message.ackId } : {}),
    ...(message.callId ? { callId: webIdOf(message.callId) } : {}),
    ...(message.agent ? { agent: message.agent } : {}),
  }
}

/** Your latest request, in your words: your newest prompt (or chat from the deck) to the Orchestrator, else the goal in hand, the newer of the two. */
function latestAskOf(data: DeckData): V2Header['goal'] {
  let asked: DeckMessage | undefined
  for (let i = data.messages.length - 1; i >= 0 && !asked; i--) {
    const one = data.messages[i]
    if (one && one.from === M.YOU && one.to === M.MAIN && (one.kind === 'prompt' || one.kind === 'chat')) asked = one
  }
  // the goal the deck made of an approved plan holds none of your words
  const goal = [...data.goals].reverse().find(one => one.origin !== 'plan')
  const goalAt = goal ? Math.max(goal.at, ...goal.followUps.map(one => one.at)) : -1
  if (asked && asked.at >= goalAt) {
    const words = (asked.full ?? asked.text).trim()
    const text = cutOf(words, V2_CAPS.text)
    return { text: text.text, headline: M.headlineOf(words), at: asked.at, ...(text.isCut ? { isCut: true as const } : {}), messageId: webIdOf(asked.id) }
  }
  if (!goal) return null
  const latest = goal.followUps[goal.followUps.length - 1]
  if (latest && latest.at >= goal.at) return { text: latest.text, headline: M.headlineOf(latest.text), at: latest.at }
  const text = cutOf(goal.text, V2_CAPS.text)
  return { text: text.text, headline: goal.headline, at: goal.at, ...(text.isCut ? { isCut: true as const } : {}) }
}

/** The plan, from every source Claude used (its board, the Orchestrator's TodoWrite list, the plan it had approved, its Workflows' phases); null when it used none. */
export function planOfV2(data: DeckData): V2Plan | null {
  const board = M.boardTasksOf(data).map(task => ({ id: task.id, subject: task.subject, status: task.status, owner: task.owner ?? null, ...(task.doing ? { doing: task.doing } : {}) }))
  const main = M.agentOf(data, M.MAIN)
  const items = todosOf(main?.todos)
  const approved = data.approved ? { markdown: data.approved.text, at: data.approved.at, by: data.approved.by } : null
  const workflows = data.workflows.filter(run => run.phases.length > 0).map(run => ({ id: webIdOf(run.id), name: run.name, phases: [...run.phases], startedAt: run.startedAt, endedAt: run.endedAt ?? null }))
  if (board.length === 0 && items.length === 0 && !approved && workflows.length === 0) return null
  return { board, todos: items.length > 0 ? { items, at: main?.todosAt ?? 0 } : null, approved, workflows }
}

/**
 * Every agent's latest tool calls, the newest 40, newest first: the deck's
 * own record of each (`recent`, its newest 14 per agent), its words as kept:
 * a shell call's description, else what the call was aimed at.
 */
export function activityListOf(data: DeckData): V2Activity[] {
  const calls = data.agents.filter(isTreeAgent).flatMap(agent => {
    const agentName = partyOf(data, agent.id, true)
    return agent.recent.map(call => ({ id: webIdOf(call.id), at: call.at, agent: agent.id, agentName, tool: call.tool, text: call.description || call.target, ok: call.ok ?? null, ms: call.ms ?? null }))
  })
  // newest first; of two at the same moment, the one recorded later first
  return calls
    .map((call, seq) => ({ call, seq }))
    .sort((a, b) => b.call.at - a.call.at || b.seq - a.seq)
    .slice(0, V2_CAPS.activity)
    .map(one => one.call)
}

/**
 * Every file the agents edited (the deck's own record, `data.files`): its
 * editors in the order of their first edit, its lines, when it was edited
 * last. The repository's first, then those outside it (`isOutside`: its
 * path stayed absolute as the deck made it relative to `root`; none with no
 * root), each the one edited last first.
 */
export function editedFilesOf(data: DeckData, root: string): V2File[] {
  const files: V2File[] = Object.values(data.files)
    .map(file => ({
      path: file.path,
      editors: file.editors.map(editor => editor.agent),
      added: file.added,
      removed: file.removed,
      lastAt: file.lastAt,
      ...(root !== '' && ABSOLUTE.test(file.path) ? { isOutside: true as const } : {}),
    }))
    .sort((a, b) => b.lastAt - a.lastAt || a.path.localeCompare(b.path))
  return [...files.filter(file => !file.isOutside), ...files.filter(file => file.isOutside)]
}

/** The figures' agent counts, over the agent rows but the Orchestrator's and Claude Code's own loops: a stopped one is stopped, never failed; an idle one counts for none. */
function rowCountsOf(rows: readonly V2Row[]): Pick<V2Figures, 'running' | 'waiting' | 'done' | 'failed' | 'stopped'> {
  const counts = { running: 0, waiting: 0, done: 0, failed: 0, stopped: 0 }
  for (const row of rows) {
    if (row.row !== 'agent' || row.kind === 'orchestrator' || row.kind === 'engine') continue
    if (row.isStopped) counts.stopped += 1
    else if (row.status === 'running' || row.status === 'starting') counts.running += 1
    else if (row.status === 'waiting') counts.waiting += 1
    else if (row.status === 'done') counts.done += 1
    else if (row.status === 'failed') counts.failed += 1
  }
  return counts
}

/** The plan's figure, only from a list of Claude's with statuses: its board's tasks done of all, else the Orchestrator's TodoWrite items; null otherwise. */
function planFigureOf(plan: V2Plan | null): V2Figures['plan'] {
  if (!plan) return null
  if (plan.board.length > 0) return { done: plan.board.filter(task => task.status === 'done').length, total: plan.board.length }
  const items = plan.todos?.items ?? []
  if (items.length > 0) return { done: items.filter(item => item.status === 'done').length, total: items.length }
  return null
}

/** Now's figures strip, from the rows and the plan built already: the agents by status, the plan's count, the spend, the tokens, the minutes and the needs. */
function figuresOf(data: DeckData, rows: readonly V2Row[], plan: V2Plan | null, needs: number, usage: UsageInfo | null, now: number): V2Figures {
  const tokens = data.agents.filter(isTreeAgent).reduce((sum, agent) => sum + agent.tokensIn + agent.tokensOut + agent.cacheRead, 0)
  return {
    ...rowCountsOf(rows),
    plan: planFigureOf(plan),
    costUsd: usage?.costUsd ?? null,
    tokens,
    contextPercent: usage?.contextPercent ?? null,
    minutes: M.goalOf(data) ? M.goalMinutesOf(data, now) : Math.max(0, Math.floor((now - data.startedAt) / 60_000)),
    needs,
  }
}

/** The header's line: "opus-5.5 · context 41% · $4.12", each part left out while unknown. */
function headerLineOf(model: string, usage: UsageInfo | null): string {
  const percent = usage?.contextPercent
  const parts = [model, percent !== undefined ? `context ${Math.round(percent)}%` : '', usage?.costUsd !== undefined ? F.money(usage.costUsd) : '']
  return parts.filter(part => part !== '').join(' · ')
}

/**
 * The one view model every surface draws (web/CONTRACT.md, v2), from the
 * deck's live model at `now`: the header, what needs you, the tree of
 * agents with its fold rows, the plan as Claude made it (null for none),
 * the one chat, the changes, Inspect's first part and the acks.
 * `answerable` holds the questions whose race is live in this mod instance.
 * Pure: the same data, git, usage and `now` build the same state.
 */
export function deckStateOf(
  data: DeckData,
  git: GitState,
  usage: UsageInfo | null,
  now: number,
  sessionId: string,
  cwd: string,
  answerable: ReadonlySet<string> = new Set(),
  gitDiffs: GitDiffs = new Map(),
  avatarStyle: string = AV.DEFAULT_STYLE,
  cleared: Cleared = NONE_CLEARED,
): WebStateV2 {
  const root = git.root || ''
  const isRepo = git.isRepo === true && root !== ''
  const main = M.agentOf(data, M.MAIN)
  const needs = needsListOf(data, now, answerable)
  const needsBy = new Map<string, number>()
  for (const need of needs) needsBy.set(need.agent, (needsBy.get(need.agent) ?? 0) + 1)
  const isWorking = main?.status === 'running' || data.agents.some(agent => (agent.kind === 'agent' || agent.kind === 'teammate') && M.isLive(agent.status))
  const state: V2Header['state'] = needs.length > 0 ? 'waiting' : isWorking ? 'working' : 'idle'
  const model = shortModel(main?.model)
  const turnId = data.mainTurnId
  const edits = data.edits.slice(-V2_CAPS.edits)
  // each agent at work with its Stop, or why none, by Claude Code's own verdicts (hooks/background.ts)
  const rows = B.withStops(agentRowsOf(data, now, needsBy), data)
  const plan = planOfV2(data)
  // what "Clear finished" hid is marked last, over the state as built
  return clearedStateOf({
    v: 2,
    now,
    session: { id: sessionId, cwd, startedAt: data.startedAt },
    avatarStyle: AV.styleOf(avatarStyle),
    header: {
      state,
      stateText: STATE_TEXT[state],
      goal: latestAskOf(data),
      model,
      contextPercent: usage?.contextPercent ?? null,
      costUsd: usage?.costUsd ?? null,
      line: headerLineOf(model, usage),
      turn: turnId !== undefined ? { id: turnId, at: data.mainTurnAt ?? null } : null,
    },
    needs,
    agents: rows,
    background: B.backgroundOf(data, rows, now),
    activity: activityListOf(data),
    files: editedFilesOf(data, root),
    figures: figuresOf(data, rows, plan, needs.length, usage, now),
    plan,
    // oldest first by when each was said: a word recorded late (a result, a choice) still sits where it was said
    chat: data.messages
      .slice(-V2_CAPS.chat)
      .map(message => chatRowOf(data, message))
      .sort((a, b) => a.at - b.at),
    changes: {
      repo: isRepo ? { name: F.baseName(root.replace(/[\\/]+$/, '')), root, branch: git.branch, ahead: git.ahead, behind: git.behind, head: git.head } : null,
      files: isRepo
        ? git.files.map(file => ({
            path: file.path,
            code: file.code,
            added: file.added,
            removed: file.removed,
            edits: edits.filter(edit => M.samePath(edit.path, file.path)).map(edit => webIdOf(edit.id)),
            diffId: gitDiffs.get(file.path)?.id ?? null,
          }))
        : [],
      edits: edits.map(edit => ({ id: webIdOf(edit.id), agent: edit.agent, tool: edit.tool, path: edit.path, at: edit.at, added: edit.added, removed: edit.removed, ...(root !== '' && ABSOLUTE.test(edit.path) ? { isOutside: true as const } : {}) })),
      commits: isRepo
        ? git.commits.slice(0, V2_CAPS.commits).map(commit => ({ hash: commit.hash, short: commit.short, subject: commit.subject, author: commit.author, at: commit.at, added: commit.added, removed: commit.removed, files: commit.files, agent: data.commitsBy[commit.hash] ?? null }))
        : [],
    },
    inspect: {
      contextPercent: usage?.contextPercent ?? null,
      costUsd: usage?.costUsd ?? null,
      agents: data.agents
        .filter(isTreeAgent)
        .map(agent => ({ id: agent.id, title: rowTitleOf(agent), model: shortModel(agent.model), tokens: { in: agent.tokensIn, out: agent.tokensOut, cacheRead: agent.cacheRead }, requests: agent.requests, tools: agent.tools, errors: agent.errors })),
    },
    acks: data.acks.slice(-V2_CAPS.acks).map(ack => ({ id: ack.id, ok: ack.ok, status: ack.status, text: ack.text, at: ack.at })),
    cleared: { count: 0, at: null },
  }, cleared)
}

/** Agent `agent`'s own file, `agents/<id>.json`: its words whole, its list, its latest calls and its edits. */
export function agentFileOf(data: DeckData, agent: DeckAgent): V2AgentFile {
  return {
    v: 2,
    id: agent.id,
    task: agent.kind === 'main' ? '' : agent.prompt,
    result: resultOf(agent),
    todos: todosOf(agent.todos),
    activity: agent.recent.map(call => ({
      id: webIdOf(call.id),
      at: call.at,
      tool: call.tool,
      target: call.target,
      ...(call.command ? { command: call.command } : {}),
      ...(call.description ? { description: call.description } : {}),
      ok: call.ok ?? null,
      ms: call.ms ?? null,
    })),
    edits: data.edits.filter(edit => edit.agent === agent.id).map(edit => webIdOf(edit.id)),
  }
}

/** Every agent's file as `agents/<id>.json` holds it (the Orchestrator's, its agents', its teammates'), by its file-safe id (`webIdOf`). */
export function agentFilesOf(data: DeckData): { id: string; text: string }[] {
  return data.agents.filter(isTreeAgent).map(agent => ({ id: webIdOf(agent.id), text: `${JSON.stringify(agentFileOf(data, agent))}\n` }))
}

/**
 * The lazy files of a v2 state as the pane opens them, by the ids the state
 * names: an agent's file (a row's `fileId`), an edit's patch (an edit's
 * `id`), a cut message's whole text (a chat row's `id`); null for none. The
 * web page fetches the same from /agent/<id>, /patch/<id> and /message/<id>.
 */
export type V2Files = {
  agent: (fileId: string) => V2AgentFile | null
  patch: (id: string) => string | null
  /** Git's own diff of an uncommitted file, by its `diffId`; null for none. */
  gitDiff: (id: string) => string | null
  /** A cut message's whole text while the deck holds it whole; null once only its file has it (the pane's `loadMessage` reads that one). */
  message: (id: string) => string | null
  /** Org's Timeline (./timeline; timeline.json, /timeline) of the v2 state `state`; null where there is none (a sample without one). */
  timeline: (state: WebStateV2) => V2Timeline | null
}

/** The live deck's lazy files, made from its model when asked for. */
export function v2FilesOf(data: DeckData, gitDiffs: GitDiffs = new Map()): V2Files {
  // the timeline built last, for the state it was built for: a screen draws one state many times
  let made: { state: WebStateV2; timeline: V2Timeline } | null = null
  return {
    timeline: state => {
      if (made?.state !== state) made = { state, timeline: timelineOf(data, state) }
      return made.timeline
    },
    gitDiff: id => [...gitDiffs.values()].find(one => one.id === id)?.text ?? null,
    agent: id => {
      const agent = data.agents.find(one => isTreeAgent(one) && webIdOf(one.id) === id)
      return agent ? agentFileOf(data, agent) : null
    },
    patch: id => data.edits.find(edit => webIdOf(edit.id) === id)?.patch ?? null,
    message: id => {
      const own = data.messages.find(one => webIdOf(one.id) === id)
      if (!own) return null
      return own.full ?? (own.isSaved !== true && Array.from(own.text).length < M.LIMITS.messageChars ? own.text : null)
    },
  }
}

/** The sample's lazy files (web/fixtures/v2/), as read, by kind and id. */
export function v2FilesFrom(files: {
  agents: Readonly<Record<string, V2AgentFile>>
  patches: Readonly<Record<string, string>>
  messages: Readonly<Record<string, string>>
  gitDiffs?: Readonly<Record<string, string>>
  /** The sample's timeline (web/fixtures/v2/timeline.json), its times moved as the state's were. */
  timeline?: V2Timeline | null
}): V2Files {
  const own = <T>(record: Readonly<Record<string, T>>, id: string): T | null => (Object.hasOwn(record, id) ? (record[id] ?? null) : null)
  return { agent: id => own(files.agents, id), patch: id => own(files.patches, id), message: id => own(files.messages, id), gitDiff: id => own(files.gitDiffs ?? {}, id), timeline: () => files.timeline ?? null }
}

// Git's own diff of each uncommitted file (gitdiffs/<id>.diff): what the mod read, by path.

/** Git's diff of each uncommitted file the mod read, by its path as git gave it: its id and its text (`gitDiffTextOf`). */
export type GitDiffs = ReadonlyMap<string, { id: string; text: string }>

/** The most characters of one file's diff the mod keeps; a longer one has no `diffId`. */
export const GIT_DIFF_MOST = 200_000

/** A file's hunks as gitdiffs/<id>.diff holds them, as a patch file does: each `@@ -a,b +c,d @@` header and its lines, whole, ending in a newline; '' for none. */
export function gitDiffTextOf(hunks: readonly Hunk[]): string {
  if (hunks.length === 0) return ''
  return `${hunks.map(hunk => [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines].join('\n')).join('\n')}\n`
}

/**
 * The id of `path`'s diff `text`, `[A-Za-z0-9_-]`: the path's hash, the
 * text's and its length, in base 36. A diff that changes gets another id, so
 * each file is written once and a page never holds a stale one.
 */
export function gitDiffIdOf(path: string, text: string): string {
  return `${F.hash(path).toString(36)}-${F.hash(text).toString(36)}-${text.length.toString(36)}`
}

/** The git diffs to write, each once: those whose id `written` does not hold yet. */
export function newGitDiffsOf(gitDiffs: GitDiffs, written: ReadonlySet<string>): { id: string; text: string }[] {
  return [...gitDiffs.values()].filter(one => !written.has(one.id))
}

/** Where a composer's words go: the agent, its row's title, and the words after the `@name`. */
export type Recipient = { agentId: string; title: string; text: string }

/** An agent an `@name` could mean, as `recipientOf` offers it when the name fits several: its id, its title, and an `@` handle that names it alone. */
export type RecipientCandidate = { agentId: string; title: string; handle: string }

/** Why the words cannot go; `ambiguous`, the agents the `@name` fits equally well, when it fits several ("Did you mean: …"). */
export type RecipientMiss = { error: string; ambiguous?: RecipientCandidate[] }

/** How `@` compares names: lowercased, and nothing but a–z and 0–9 kept ("Native Chat!" is "nativechat"). */
export function mentionKeyOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** The words of an `@name`: split at anything but a letter or a digit, and where a lowercase letter or digit meets a capital ("NativeChat", "native-chat": native, chat), each as `mentionKeyOf` has it. */
export function mentionWordsOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map(mentionKeyOf)
    .filter(word => word !== '')
}

/** An agent's `@` handle that names it alone: its short id, else its name, else its id. */
function candidateOf(row: V2AgentRow): RecipientCandidate {
  return { agentId: row.id, title: row.title, handle: row.shortId || row.name || row.id }
}

/**
 * The agents `handle` (an `@name` less its `@`) means, by the first rule any
 * agent passes, each over its `name` and its `title` as `mentionKeyOf` has
 * them:
 *
 * 1. its id or its short id, exactly (any case);
 * 2. a name that is the handle;
 * 3. a name that starts with it;
 * 4. a name that holds it;
 * 5. a name that holds each of its words (`mentionWordsOf`).
 *
 * Of those, the agents at work or waiting on you (starting, running,
 * waiting) win over the rest, then the newest (`startedAt`); those left
 * tied are what it returns, in the state's order (one: the agent it means).
 */
export function mentionedBy(rows: readonly V2AgentRow[], handle: string): V2AgentRow[] {
  const raw = handle.toLowerCase()
  const key = mentionKeyOf(handle)
  const words = mentionWordsOf(handle)
  const names = (row: V2AgentRow) => [row.name, row.title].map(mentionKeyOf).filter(name => name !== '')
  const rules: ((row: V2AgentRow) => boolean)[] = [
    row => row.id.toLowerCase() === raw || (row.shortId !== '' && row.shortId.toLowerCase() === raw),
    row => key !== '' && names(row).some(name => name === key),
    row => key !== '' && names(row).some(name => name.startsWith(key)),
    row => key !== '' && names(row).some(name => name.includes(key)),
    row => words.length > 0 && names(row).some(name => words.every(word => name.includes(word))),
  ]
  const isLive = (row: V2AgentRow) => !row.isStopped && (row.status === 'starting' || row.status === 'running' || row.status === 'waiting')
  for (const rule of rules) {
    const hits = rows.filter(rule)
    if (hits.length === 0) continue
    const live = hits.some(isLive) ? hits.filter(isLive) : hits
    const newest = Math.max(...live.map(row => row.startedAt))
    return live.filter(row => row.startedAt === newest)
  }
  return []
}

/** "Did you mean: Native chat (@a1b2c3d) or Native pane (@e4f5a6b)?", four at most. */
function didYouMean(candidates: readonly RecipientCandidate[]): string {
  const said = candidates.slice(0, 4).map(one => `${one.title} (@${one.handle})`)
  const more = candidates.length > 4 ? `, or ${candidates.length - 4} more` : ''
  const list = said.length > 1 && more === '' ? `${said.slice(0, -1).join(', ')} or ${said[said.length - 1]}` : said.join(', ')
  return `Did you mean: ${list}${more}?`
}

/**
 * Who a composer's words go to: `@name` first sends the rest to the agent it
 * means (`mentionedBy`: its id or short id, else its name or title, whole,
 * at its start, inside it, or word by word, the agents at work or waiting
 * first, then the newest), by SendMessage; words with no `@` go to the
 * Orchestrator. `error` says why they cannot be sent: no agent of that
 * name, a name that fits several equally (`ambiguous`, the composer's "Did
 * you mean: …"), or nothing after it.
 */
export function recipientOf(state: Pick<WebStateV2, 'agents'>, words: string): Recipient | RecipientMiss {
  const said = words.trim()
  const at = /^@(\S+)\s*([\s\S]*)$/.exec(said)
  const rows = state.agents.filter((row): row is V2AgentRow => row.row === 'agent')
  if (!at) {
    const main = rows.find(row => row.id === M.MAIN)
    return said === '' ? { error: 'Nothing to send' } : { agentId: M.MAIN, title: main?.title ?? M.ORCHESTRATOR, text: said }
  }
  const handle = at[1] ?? ''
  const text = (at[2] ?? '').trim()
  const found = mentionedBy(
    rows.filter(row => row.id !== M.MAIN),
    handle,
  )
  if (found.length === 0) return { error: `No agent named @${handle} in this session` }
  if (found.length > 1) {
    const ambiguous = found.map(candidateOf)
    return { error: didYouMean(ambiguous), ambiguous }
  }
  const agent = found[0]!
  if (text === '') return { error: 'Nothing to send' }
  return { agentId: agent.id, title: agent.title, text }
}

/** What a v2 state shows, as one key: every field of it but when it was built. Equal keys draw the same screens. */
export function v2KeyOf(state: WebStateV2): string {
  const text = JSON.stringify({ ...state, now: 0 })
  return `${F.hash(text).toString(36)}:${text.length}`
}

// The pane's focus (`j`, `k`, `n`): the rows it moves among, by the keys
// their Buttons are drawn under.

/** The pane's Button key of a need's card: `need:` and the need's id. */
export function needKeyOf(id: string): string {
  return `need:${id}`
}

/** The pane's Button key of an agent's row: `agent:` and its id. A fold row's key is its own id (`fold:` and its parent's id). */
export function agentKeyOf(id: string): string {
  return `agent:${id}`
}

/** The pane's Button key of a file of Changes: `file:` and its path as git gave it. */
export function fileKeyOf(path: string): string {
  return `file:${path}`
}

/**
 * The rows `j` and `k` move the pane's focus among, by their Buttons' keys,
 * in the order the screen draws them. Now: each need (`needKeyOf`), then
 * the tree's rows: each agent row drawn (`agentKeyOf`; a fold's member only
 * while that fold is open) and each fold row (its id). Changes: git's files
 * (`fileKeyOf`). None on Chat, Org (its screen passes its own keys to
 * `focusNext`), an agent's page (`page` its id) or Inspect.
 */
export function focusKeysOf(state: Pick<WebStateV2, 'needs' | 'agents' | 'changes'>, view2: Pick<DeckView2, 'tab' | 'openFolds' | 'isInspectOpen'>, page: string): string[] {
  if (page !== '' || view2.isInspectOpen) return []
  if (view2.tab === 'changes') return state.changes.files.map(file => fileKeyOf(file.path))
  if (view2.tab !== 'now') return []
  const open = new Set(view2.openFolds)
  const rows = state.agents.flatMap(row => (row.row === 'fold' ? [row.id] : !row.isCleared && (row.fold === null || open.has(row.fold)) ? [agentKeyOf(row.id)] : []))
  return [...state.needs.map(need => needKeyOf(need.id)), ...rows]
}

/**
 * Where `j` (1) or `k` (-1) takes the focus from the row keyed `current`
 * among `keys`: the next or the one before, held at either end. From none
 * (or one not among them), `j` takes the first and `k` the last; '' when
 * there is no row.
 */
export function focusStepOf(keys: readonly string[], current: string, dir: 1 | -1): string {
  if (keys.length === 0) return ''
  const at = keys.indexOf(current)
  if (at < 0) return (dir > 0 ? keys[0] : keys[keys.length - 1]) ?? ''
  return keys[Math.min(keys.length - 1, Math.max(0, at + dir))] ?? ''
}

/** `n`: the key of the need after the one keyed `current` (round to the first; the first from anything else); '' when nothing needs you. */
export function nextNeedKeyOf(state: Pick<WebStateV2, 'needs'>, current: string): string {
  const keys = state.needs.map(need => needKeyOf(need.id))
  if (keys.length === 0) return ''
  return keys[(keys.indexOf(current) + 1) % keys.length] ?? ''
}

// The band above the prompt: one line, "● 3 working · ? 1 question".

/** One part of the band's line: the agents at work, the needs of one kind, the background tasks or the schedules, or the other sessions waiting on you; `text` its words ("3 working", "1 question", "2 in the background", "1 scheduled", "1 other session needs you"). */
export type V2BandPart = { kind: 'working' | V2Need['kind'] | B.BandPart['kind'] | 'sessions'; glyph: '●' | '?' | B.BandPart['glyph'] | '◆'; count: number; text: string }

/** The band's line, made once here: its parts in order (at work, then questions, permissions, notifications) and them as one string. */
export type V2Band = { parts: V2BandPart[]; text: string }

const BAND_NOUNS: Readonly<Record<V2Need['kind'], readonly [string, string]>> = { question: ['question', 'questions'], permission: ['permission', 'permissions'], notification: ['notification', 'notifications'] }

/**
 * What the band says, from the v2 state: how many agents are at work (each
 * row but the Orchestrator's and Claude Code's own loops, starting or
 * running), then how many of each kind of need wait on you, then what runs
 * in the background and what is scheduled (`background`), then how many
 * other sessions on this machine wait on you (`sessions`). Null when none
 * is: the band then shows nothing.
 */
export function bandOf(state: Pick<WebStateV2, 'agents' | 'needs' | 'sessions'> & { background?: B.V2Background }): V2Band | null {
  const working = state.agents.filter(row => row.row === 'agent' && row.kind !== 'orchestrator' && row.kind !== 'engine' && (row.status === 'running' || row.status === 'starting')).length
  const parts: V2BandPart[] = working > 0 ? [{ kind: 'working', glyph: '●', count: working, text: `${working} working` }] : []
  for (const kind of ['question', 'permission', 'notification'] as const) {
    const count = state.needs.filter(need => need.kind === kind).length
    const [one, many] = BAND_NOUNS[kind]
    if (count > 0) parts.push({ kind, glyph: '?', count, text: `${count} ${count === 1 ? one : many}` })
  }
  parts.push(...B.bandPartsOf(state.background))
  const others = othersLineOf(state.sessions)
  if (others !== null && state.sessions) parts.push({ kind: 'sessions', glyph: '◆', count: state.sessions.others.waiting, text: others })
  if (parts.length === 0) return null
  return { parts, text: parts.map(part => `${part.glyph} ${part.text}`).join(' · ') }
}

// The sample (`/deck demo`): an answer given in it, there alone.

/**
 * The sample's state with its question `callId` (a need's id) answered in
 * it alone, nothing sent: the need taken down, a `choice` row from you to
 * the agent that asked ("You answered: …"), that agent's row at work again
 * once nothing else of its waits on you, and the header's word. Null when
 * the sample holds no such question, or the answer says nothing.
 */
export function answeredInSample(state: WebStateV2, callId: string, answers: Readonly<Record<string, string>>, now: number): { state: WebStateV2; words: string } | null {
  const need = state.needs.find(one => one.id === callId && one.kind === 'question')
  if (!need) return null
  const words = M.answeredOf(need.questions ?? [], answers)
  if (words === '') return null
  const needs = state.needs.filter(one => one !== need)
  const left = needs.filter(one => one.agent === need.agent).length
  const agents = state.agents.map(row => (row.row === 'agent' && row.id === need.agent ? { ...row, needs: left, status: left === 0 && row.status === 'waiting' ? ('running' as const) : row.status } : row))
  const choice: V2ChatRow = { id: webIdOf(`sample-choice-${now}`), at: now, from: M.YOU, to: need.agent, who: `You → ${need.agentName}`, kind: 'choice', text: `You answered: ${words}`, callId: need.id }
  const isWorking = agents.some(row => row.row === 'agent' && (row.status === 'running' || row.status === 'starting'))
  const word: V2Header['state'] = needs.length > 0 ? 'waiting' : isWorking ? 'working' : 'idle'
  const header = { ...state.header, state: word, stateText: STATE_TEXT[word] }
  const figures = { ...state.figures, ...rowCountsOf(agents), needs: needs.length }
  return { state: { ...state, header, needs, agents, figures, chat: [...state.chat, choice].slice(-V2_CAPS.chat) }, words }
}

/** The fields of a v2 state, or of its agent files, that hold a time: moved together when a recorded state is shown now. */
const TIME_KEYS: ReadonlySet<string> = new Set(['now', 'at', 'startedAt', 'endedAt', 'lastAt', 'nextAt'])

/** `value` (a v2 state, or an agent file) with every time in it (`now`, `at`, `startedAt`, `endedAt`, `lastAt`, a schedule's `nextAt`, past 2001) moved by `by` ms. */
export function v2TimesMoved<T>(value: T, by: number): T {
  const move = (one: unknown): unknown => {
    if (Array.isArray(one)) return one.map(move)
    if (one === null || typeof one !== 'object') return one
    const out: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(one as Record<string, unknown>)) out[key] = TIME_KEYS.has(key) && typeof field === 'number' && field > 1e12 ? field + by : move(field)
    return out
  }
  return move(value) as T
}

/** A recorded v2 state (web/fixtures/state.v2.json) as shown at `now`: its times moved so it was built then. Null for text that is no v2 state. */
export function v2StateFromText(text: string, now: number): WebStateV2 | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || value.v !== 2 || typeof value.now !== 'number' || !Array.isArray(value.agents) || !Array.isArray(value.chat) || !Array.isArray(value.needs) || !Array.isArray(value.acks)) return null
  if (!isRecord(value.header) || !isRecord(value.changes) || !isRecord(value.inspect) || !isRecord(value.session)) return null
  if (!Array.isArray(value.activity) || !Array.isArray(value.files) || !isRecord(value.figures)) return null
  return v2TimesMoved(value as unknown as WebStateV2, now - value.now)
}

/**
 * What agent `agentId`'s thread in a v1 state ends with, as one string (its
 * length, its last message and the last word on that one's command): a
 * change says something new came at its end. The pane's Talk keeps to its
 * end with it.
 */
export function threadEndOf(state: WebState, agentId: string): string {
  const thread = state.messages.filter(message => message.from === agentId || message.to === agentId)
  const last = thread[thread.length - 1]
  if (!last) return ''
  let ack: WebAck | undefined
  for (let i = state.acks.length - 1; i >= 0 && last.ackId && !ack; i--) if (state.acks[i]?.id === last.ackId) ack = state.acks[i]
  return `${thread.length}|${last.id}|${ack ? `${ack.status}:${ack.text}` : ''}`
}

// The server: how it is started, and what it prints back.

/** The page's address: the server's port on 127.0.0.1, the token as `t`. */
export function webUrlOf(port: number, token: string): string {
  return `http://127.0.0.1:${port}/?t=${encodeURIComponent(token)}`
}

/** The server's command line (no shell): node, web/server.js, its folder, the session's pid to outlive no longer, the port to take again, and the registry of sessions (./sessions) whose folders it may read too. */
export function serverArgvOf(script: string, dir: string, pid: string, port: number, sessions = ''): string[] {
  return ['node', script, '--dir', dir, ...(pid ? ['--parent', pid] : []), ...(port > 0 ? ['--port', String(port)] : []), ...(sessions ? ['--sessions', sessions] : [])]
}

/** A line the server printed: its first, `{"ready":<port>}`, or a command from the page. */
export type ServerLine = { kind: 'ready'; port: number } | { kind: 'cmd'; cmd: Record<string, unknown> }

/** What a command from the page asks the mod to do, checked against the model. */
export type WebRoute =
  | { kind: 'chat'; agentId: string; text: string }
  | { kind: 'review'; text: string }
  /** Answers to a question the engine holds a call on: by question text, a label, labels comma-joined, or words of your own. */
  | { kind: 'answer'; callId: string; answers: Record<string, string> }
  /** Stops a background agent or a teammate at work (TaskStop): a foreground one ends with its caller's turn. */
  | { kind: 'stopAgent'; agentId: string }
  /** Ends the main loop's running turn (`$.turn.abort`), as Esc in Claude Code does. */
  | { kind: 'abortTurn'; turnId: string }
  /** Stops a background task (TaskStop) or cancels a schedule (CronDelete): its row's `bgId` in `background`. */
  | { kind: 'stopBackground'; bgId: string }
  /** Draws the agents' avatars in another style (web/avatars.mjs `STYLE_IDS`): the person's setting, on every surface. */
  | { kind: 'avatarStyle'; style: AV.AvatarStyle }
  /** "Clear finished": the finished agents hidden from the Dashboard, Chat and Org (the deck's own tidying, nothing in Claude Code). */
  | { kind: 'clearFinished' }
  /** "Show N cleared": the agents "Clear finished" hid shown again. */
  | { kind: 'showCleared' }
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

/** The agent a `stopAgent` may stop: a background agent or a teammate (never the Orchestrator, which `abortTurn` stops) still at work. */
function stoppableOf(data: DeckData, agentId: unknown): DeckAgent | undefined {
  const agent = typeof agentId === 'string' ? M.agentOf(data, agentId) : undefined
  if (!agent || (agent.kind !== 'agent' && agent.kind !== 'teammate')) return undefined
  return (agent.kind === 'teammate' || agent.background === true) && M.isLive(agent.status) ? agent : undefined
}

/**
 * What a command asks, once it is checked against the model: a `chat` to an
 * agent the deck holds (the Orchestrator, a subagent, a teammate), a `review`
 * prompt, an `answer` to a question (its call, as the state's need or chat
 * row names it, and answers; whether that call still waits is the hooks
 * module's to tell), a `stopAgent` of a background agent or teammate at
 * work, an `abortTurn` of the main loop's running turn (the one named, when
 * one is), or a `ping`. Text must be a string, not blank, at most 4000
 * characters. Anything else is null, to be refused (`refusalOf` says why).
 */
export function routeOf(cmd: unknown, data: DeckData): WebRoute | null {
  if (!isRecord(cmd)) return null
  if (cmd.cmd === 'ping') return { kind: 'ping' }
  // an answer has no text of its own: it is read before the text is
  if (cmd.cmd === 'answer') {
    const answers = answersOf(cmd.answers)
    const said = typeof cmd.callId === 'string' ? cmd.callId.trim() : ''
    // v2 names a call file-safe (`webIdOf`): the call held under that name is the one meant
    const callId = data.pending.find(item => item.id === said)?.id ?? data.pending.find(item => webIdOf(item.id) === said)?.id ?? said
    return callId !== '' && callId.length <= 200 && answers ? { kind: 'answer', callId, answers } : null
  }
  if (cmd.cmd === 'stopAgent') {
    const agent = stoppableOf(data, cmd.agentId)
    return agent ? { kind: 'stopAgent', agentId: agent.id } : null
  }
  if (cmd.cmd === 'abortTurn') {
    const turnId = data.mainTurnId
    if (turnId === undefined || (cmd.turnId !== undefined && cmd.turnId !== turnId)) return null
    return { kind: 'abortTurn', turnId }
  }
  if (cmd.cmd === 'stopBackground') return B.rowByBgId(data, cmd.bgId) ? { kind: 'stopBackground', bgId: cmd.bgId as string } : null
  if (cmd.cmd === 'avatarStyle') return AV.isStyle(cmd.style) ? { kind: 'avatarStyle', style: cmd.style } : null
  if (cmd.cmd === 'clearFinished') return { kind: 'clearFinished' }
  if (cmd.cmd === 'showCleared') return { kind: 'showCleared' }
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
  if (cmd.cmd === 'stopAgent') {
    const agent = typeof cmd.agentId === 'string' ? M.agentOf(data, cmd.agentId) : undefined
    if (!agent || (agent.kind !== 'agent' && agent.kind !== 'teammate')) return agent?.kind === 'main' ? 'The Orchestrator stops with its turn: Stop turn' : 'No such agent in this session'
    if (!M.isLive(agent.status)) return 'It is not at work'
    if (agent.kind !== 'teammate' && agent.background !== true) return "Only a background agent or a teammate can be stopped: a foreground one ends with its caller's turn (Stop turn)"
    return 'Not stopped'
  }
  if (cmd.cmd === 'abortTurn') return data.mainTurnId === undefined ? 'No turn is running' : 'That turn has ended'
  if (cmd.cmd === 'stopBackground') return 'Nothing runs in the background by that name: it may have ended'
  if (cmd.cmd === 'avatarStyle') return `Not an avatar style the deck knows: ${F.trunc(F.oneLine(String(cmd.style ?? '')), 40)}`
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
