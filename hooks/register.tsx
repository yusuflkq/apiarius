/**
 * Agent Deck: a pane (`/deck`) that shows the session's git state and every
 * agent's work, and a band above the prompt while subagents run.
 *
 * The hooks here record what the engine reports (tool calls, spawns, turns,
 * messages between agents) into one live model, run git in the background,
 * and draw the views from `./views`. `/deck web` serves the same model as a
 * live dashboard in the Desktop's Browser pane (`./web`, web/CONTRACT.md).
 * Every `$` call lives in this file.
 */
import type {
  AgentInfo,
  CommandRunResult,
  Elements,
  EngineInterface,
  Register,
  RenderElement,
  RenderInput,
  RenderSurface,
  SessionMessage,
  Timer,
  ToolCallResult,
} from 'claude-code'

import type { DeckActivity, DeckAgent, DeckData, DeckStatus, DeckView } from '../types'
import { addedFileHunks, countOf, hunksOf, patchOf, replaceHunks, type Hunk } from './diff'
import * as F from './format'
import * as G from './git'
import * as M from './model'
import * as R from './repos'
import { bandView } from './ui/band'
import * as O from './ui/outlineModel'
import { T } from './ui/theme'
import type { Actions, ChatLine, DayRow, DeckModel, Kit, UsageInfo, WebPane } from './ui/types'
import { deckView } from './views'
import * as W from './web'

const PANE = 'agent-deck'
const SNAPSHOT = { plugin: 'agent-deck', key: 'snapshot' } as const
const HISTORY_KEY = 'history'
const HISTORY_DAYS = 21

type History = Record<string, Record<string, Omit<DayRow, 'day' | 'sessions'>>>

let data: DeckData = M.emptyData(0)
let view: DeckView = M.defaultView()
let git: G.GitState = G.emptyGit()
let cwd = ''
let sessionId = ''
let usage: UsageInfo | null = null
let usageAt = 0
let days: DayRow[] = []
let daysAt = 0
let fileDiff: G.FileDiff | null = null
let commit: G.CommitDetail | null = null
let chat: { agent: string; lines: ChatLine[]; at: number } | null = null
let isPaneOpen = false
let isGitBusy = false
let isGitQueued = false
let isHeavyQueued = false
let lastGitAt = 0
let lastHeavyAt = 0
const timers: { git?: Timer; save?: Timer; tick?: Timer; day?: Timer; dump?: Timer; web?: Timer } = {}
/** The screen key the last drawing showed (or the last timed redraw asked for); see `screenKey`. */
let shownKey = ''
let gitKeyMemo: { of: G.GitState; key: string } | null = null

/** Draws every site of this plugin again; the engine folds calls to ten a second. Events that change the data call it. */
function redraw($: EngineInterface) {
  $.ui.invalidate('ui.render')
}

/** What the git half of the screen shows: not when git was read, only whether it has been and what it found. */
function gitKeyOf(state: G.GitState): string {
  if (gitKeyMemo?.of === state) return gitKeyMemo.key
  const files = F.hash(state.files.map(file => `${file.code}${file.path}\t${file.added}\t${file.removed}`).join('\n'))
  const key = [
    state.isRepo,
    state.checkedAt > 0,
    state.root,
    state.branch,
    state.head,
    state.upstream,
    state.ahead,
    state.behind,
    state.files.length,
    state.added,
    state.removed,
    files,
    state.error ?? '',
    state.pinned,
    state.repos.map(repo => repo.root).join(','),
    state.commits.length,
    state.today.commits,
    state.today.added,
    state.today.removed,
    state.sessionCommits,
  ].join('|')
  gitKeyMemo = { of: state, key }
  return key
}

/**
 * Everything on screen, as one key: each agent's status, now text and coarse
 * elapsed time while it runs, the banner; the Agents tab's goal, plan,
 * checklists, last actions, files, messages, needs-you line and summary
 * (`M.deckKeyOf`); git (whether read, HEAD, branch, files and counts); the
 * usage figures rounded; the day history; the edits; and on the Stats tab
 * the session's totals and the minute. Equal keys draw the same screen.
 */
function screenKey(now: number): string {
  const figures = usage
    ? [Math.round(usage.contextPercent ?? -1), F.money(usage.costUsd), ...usage.limits.map(limit => `${limit.kind}:${Math.round(limit.percentUsed)}`)].join(' ')
    : ''
  const isStats = isPaneOpen && view.tab === 'stats'
  const minute = isStats ? M.minuteOf(now) : ''
  const totals = isStats ? JSON.stringify([M.totalsOf(data), data.minutes[data.minutes.length - 1] ?? null]) : ''
  const edits = `${data.edits.length}:${data.edits[data.edits.length - 1]?.id ?? ''}`
  const shown = webPaneOf()
  const webKey = `${shown.status}\t${shown.url}\t${shown.opened}\t${shown.note}`
  return [M.agentsKeyOf(data, git, now), M.deckKeyOf(data, git, now), gitKeyOf(git), figures, JSON.stringify(days), minute, totals, edits, webKey].join('\n\u0001')
}

/**
 * Redraws only when the screen would change: how events, the timer and the
 * background reads draw, so nothing moves while nothing changes. (A press
 * that changes the view draws unasked, through `changed`.) A change is the
 * web deck's signal too: its state is written again.
 */
function redrawIfChanged($: EngineInterface, now: number) {
  const key = screenKey(now)
  if (key === shownKey) return
  shownKey = key
  scheduleWeb($)
  redraw($)
}

/** An event changed the data: keep it, and draw if the screen would change. */
function touched($: EngineInterface, now: number) {
  save($)
  redrawIfChanged($, now)
}

/**
 * Each directory edited in as the file system spells it, by `R.keyOf`:
 * `$.fs.stat(dir, { resolve: true }).realPath`, so an 8.3 short name
 * (`C:\Users\DEVELO~1`) reads as git prints it (`C:/Users/developer`).
 */
const realDirs = new Map<string, string>()

/** `abs` with its directory spelled as the file system resolves it; asked once per directory, the spelling given when it cannot be. */
async function realPathOf($: EngineInterface, abs: string): Promise<string> {
  const path = R.cleanPath(abs)
  if (!R.isAbsolute(path)) return path
  const dir = R.dirOf(path)
  const key = R.keyOf(dir)
  let real = realDirs.get(key)
  if (real === undefined) {
    try {
      const stat = await $.fs.stat(dir, { resolve: true })
      real = stat.realPath ? R.cleanPath(stat.realPath) : dir
      realDirs.set(key, real)
    } catch {
      return path
    }
  }
  return R.childOf(real, F.baseName(path))
}

/** The same from what is resolved already, with no file system call: for the instant a call starts. */
function knownRealOf(abs: string): string {
  const path = R.cleanPath(abs)
  const real = R.isAbsolute(path) ? realDirs.get(R.keyOf(R.dirOf(path))) : undefined
  return real === undefined ? path : R.childOf(real, F.baseName(path))
}

/** Whether `knownRealOf` can spell `abs` as the file system does already: a relative path, or one whose directory was resolved. */
function isSpelledOf(abs: string): boolean {
  const path = R.cleanPath(abs)
  return !R.isAbsolute(path) || realDirs.has(R.keyOf(R.dirOf(path)))
}

/**
 * A call that started in a directory not resolved yet (an 8.3 short name,
 * `C:\Users\DEVELO~1\…`, which git never prints) gets its target written
 * again once the file system spells the path: relative to the repository
 * like every later call there, never an absolute path cut from the left.
 */
async function respell($: EngineInterface, activity: DeckActivity, tool: string, input: Record<string, unknown>, file: string): Promise<void> {
  try {
    const real = await realPathOf($, file)
    const target = M.targetOf(tool, { ...input, file_path: real }, git.root || null, data.board)
    if (target === activity.target) return
    activity.target = target
    touched($, await $.clock.now())
  } catch {
    // the target keeps the spelling the call gave
  }
}

/** A slash command's expansion (classic UserPromptExpansion), held for the prompt it becomes: its headline. */
let expansion: { headline: string; at: number } | null = null

/** Whether the last prompt submitted, the one the next turn starts with, is the person's own words; null while none was seen. */
let isNextTurnTheirs: boolean | null = null

/**
 * A placeholder row took its agent's id: what the view held of it (the
 * selection, a fold, a zoom, as the id or inside a key) follows it.
 */
function renameInView(from: string, to: string) {
  if (from === to) return
  const swap = (value: string) => (value === from || value === `+${from}` || value.endsWith(`:${from}`) ? `${value.slice(0, value.length - from.length)}${to}` : value)
  view.agent = swap(view.agent)
  view.zoom = swap(view.zoom)
  view.folded = view.folded.map(swap)
}

/** Keeps the model in `$.state`, so a reload of this module picks it up again; while the debug folder is there, dumps it too, and while the web deck is on, writes its state. */
function save($: EngineInterface) {
  scheduleDump($)
  scheduleWeb($)
  if (timers.save) return
  timers.save = $.clock.after(1500, () => {
    timers.save = undefined
    void $.state.set(SNAPSHOT, M.copyOf({ v: M.SNAPSHOT_VERSION, data, view })).catch(() => undefined)
  })
}

/**
 * The debug dump: while `<mod>/.debug/` exists, what the live deck believes
 * goes to `.debug/<sessionId>.json` about 2 s after the data changes, for a
 * person or an agent to read without a screenshot, each session to its own
 * file. The folder is looked for at session.start and on each tick, and
 * again right before each write: with it absent nothing is written
 * (`$.fs.write` would make it).
 */
const DEBUG_DIR = '.debug'
const DUMP_MS = 2000
const debug = { isOn: false, loadedAt: 0, writes: 0 }

function debugDirOf($: EngineInterface): string {
  return `${$.plugin.root.replace(/[\\/]+$/, '')}/${DEBUG_DIR}`
}

/** Whether the debug folder is there; a look that fails counts as absent. */
async function hasDebugDir($: EngineInterface): Promise<boolean> {
  try {
    return (await $.fs.exists(debugDirOf($))) === true
  } catch {
    return false
  }
}

/** Looks for the debug folder again: one that appeared since the last look dumps soon, one gone stops the dump. */
async function checkDebug($: EngineInterface, isStart = false): Promise<void> {
  const was = debug.isOn
  debug.isOn = await hasDebugDir($)
  if (!debug.isOn) {
    timers.dump?.cancel()
    timers.dump = undefined
  } else if (!was && !isStart) {
    scheduleDump($)
  }
}

/** The data changed: a dump within about 2 s while the debug folder is there; changes meanwhile ride along. */
function scheduleDump($: EngineInterface) {
  if (!debug.isOn || timers.dump) return
  timers.dump = $.clock.after(DUMP_MS, () => {
    timers.dump = undefined
    void writeDump($)
  })
}

async function writeDump($: EngineInterface): Promise<void> {
  try {
    if (!(await hasDebugDir($))) {
      debug.isOn = false
      return
    }
    const now = await $.clock.now()
    debug.writes += 1
    const state = { meta: { at: now, loadedAt: debug.loadedAt, writes: debug.writes }, ...debugStateOf(now) }
    await $.fs.write(`${debugDirOf($)}/${W.fileNameOf(sessionId || 'state')}.json`, `${JSON.stringify(state, null, 2)}\n`)
  } catch {
    // a dump that could not be written waits for the next change
  }
}

/**
 * What the deck believes now, as plain data: the raw counts; the goal, the
 * plan (steps and links), the summary, the needs-you line and the fold; per
 * agent its label, scope, origin, status, parent, step link, checklist, step,
 * last action and result; the files; the last 20 messages; the outline's
 * rows; and how the web deck stands (never its token).
 */
function debugStateOf(now: number) {
  const plan = M.planOf(data)
  const goal = M.goalOf(data)
  const outline = O.outlineOf(data, view, now, O.MOST_ROWS, git.root)
  const nameOf = (id: string) => {
    const agent = M.agentOf(data, id)
    return agent ? M.labelOf(agent) : id
  }
  return {
    counts: {
      agents: data.agents.length,
      shownAgents: data.agents.filter(M.isShownAgent).length,
      messages: data.messages.length,
      edits: data.edits.length,
      files: Object.keys(data.files).length,
      goals: data.goals.length,
      board: Object.keys(data.board).length,
      workflows: data.workflows.length,
      turns: data.turns,
    },
    git: { root: git.root, isRepo: git.isRepo, checkedAt: git.checkedAt, files: git.files.map(file => file.path) },
    view: { tab: view.tab, selected: view.agent, zoom: view.zoom, folded: view.folded },
    goal: goal
      ? { id: goal.id, headline: goal.headline, text: F.trunc(F.oneLine(goal.text), 300), origin: goal.origin, at: goal.at, followUps: goal.followUps.map(one => F.trunc(F.oneLine(one.text), 120)), plan: goal.plan?.steps ?? null }
      : null,
    plan: { source: plan.source, goal: plan.goal ?? null, steps: plan.steps, unlinked: plan.unlinked, links: plan.links },
    summary: M.summaryOf(data, git, now),
    needs: M.needsOf(data, git, now),
    fold: M.foldOf(data) ?? null,
    agents: data.agents.map(agent => {
      const list = M.checklistOf(agent, data)
      return {
        id: agent.id,
        kind: agent.kind,
        label: M.labelOf(agent),
        scope: M.scopeOf(agent),
        origin: M.originOf(agent),
        status: agent.status,
        shown: M.statusOf(agent, data),
        parent: M.parentIdOf(data, agent) ?? null,
        step: plan.links[agent.id] ?? null,
        checklist: { done: list.done, total: list.total, items: list.items.map(item => `${item.status}: ${item.text}`) },
        stepOf: M.stepOf(agent),
        lastAction: M.lastActionOf(agent) ?? null,
        answer: agent.answer === undefined ? null : agent.answer.slice(0, 200),
        resultVia: agent.resultVia ?? null,
        tools: agent.tools,
        files: agent.files,
      }
    }),
    files: M.filesOf(data).map(file => ({ ...file, by: file.editors.map(nameOf) })),
    messages: data.messages.slice(-20).map(message => ({
      from: message.from,
      to: message.to,
      route: `${nameOf(message.from)} → ${nameOf(message.to)}`,
      kind: message.kind,
      text: F.oneLine(message.text).slice(0, 80),
    })),
    outline: {
      rows: outline.rows.map(row => ({
        id: row.id,
        depth: row.depth,
        label: row.label,
        kind: row.kind,
        status: row.status,
        fold: row.fold,
        columns: { count: row.count, minutes: row.minutes, added: row.added, removed: row.removed },
        note: row.note,
      })),
      crumbs: outline.crumbs,
      empty: outline.empty,
      hidden: outline.hidden,
    },
    web: { isOn: web.isOn, status: web.status, port: web.port, dir: web.dir, opened: web.opened, note: web.note, patches: web.written.size, hasParent: web.pid !== '' },
  }
}

/**
 * The web deck (web/CONTRACT.md). `/deck web`, or the pane's Open dashboard,
 * starts `web/server.js` for the session, answers with the page's link and
 * tries to open it in the Desktop's Browser pane. While it is on, what the
 * deck holds goes to `.web/<sessionId>/state.json` at most every 300 ms after
 * a change (`W.webStateOf`), each edit's patch once beside it, and the page's
 * commands come back as lines on the server's stdout.
 *
 * The child is the session's: `superviseWeb` runs from session.start, whose
 * `$` outlives every hook, and spawns it each time it is asked. Leaving its
 * loop (`/deck web stop`) or a reload of this module kills it, and its
 * `--parent` check ends it with the session's process (its stdin is closed
 * from the start, so stdin cannot tell it). A reload starts it again with
 * the token and port `$.state` kept: the open page reconnects by itself.
 */
const WEB_STATE = { plugin: 'agent-deck', key: 'web' } as const
/** How long a start waits for the server's ready line. */
const WEB_START_MS = 10_000

const web: {
  /** On for this session, from the first /deck web until /deck web stop, as `$.state` keeps it. */
  isOn: boolean
  /** The server's access token, the page's `t`. */
  token: string
  /** The port the server listens on, taken again after a reload; 0 before it is known. */
  port: number
  /** The port a restart asked for again, until its ready line says which it got. */
  keptPort: number
  /** The folder it serves (`<mod>/.web/<sessionId>`), fixed for the server's life. */
  dir: string
  status: WebPane['status']
  /** Why it is not running, as the pane and `/deck web` say it; '' while it runs. */
  note: string
  /** How the last try to open it in the Browser pane went. */
  opened: WebPane['opened']
  /** The session's own process (claude.exe), the server's `--parent`; '' when it could not be read. */
  pid: string
  /** The session.start the supervisor in charge belongs to. */
  epoch: number
  /** A start asked of the supervisor, and the wake of its wait. */
  isAsked: boolean
  wake?: () => void
  /** Ends the child's loop, and with it the child. */
  stop?: () => void
  /** The starts waiting for the ready line. */
  waiters: ((isUp: boolean) => void)[]
  /** The patches written, by their web id. */
  written: Set<string>
  /** The state last written, its time left out. */
  lastKey: string
  isWriting: boolean
  isWriteQueued: boolean
} = { isOn: false, token: '', port: 0, keptPort: 0, dir: '', status: 'off', note: '', opened: '', pid: '', epoch: 0, isAsked: false, waiters: [], written: new Set(), lastKey: '', isWriting: false, isWriteQueued: false }

/** The web deck as the pane draws it. */
function webPaneOf(): WebPane {
  const isUp = web.status === 'running' && web.port > 0
  return { status: web.status, url: isUp ? W.webUrlOf(web.port, web.token) : '', opened: web.opened, note: web.note }
}

/** Keeps the web deck's switch, token, port and folder in `$.state`, so a reload starts it again where it was. */
function saveWeb($: EngineInterface) {
  void $.state.set(WEB_STATE, { isOn: web.isOn, token: web.token, port: web.port, dir: web.dir }).catch(() => undefined)
}

/** Settles every start waiting for the server: up, or not. */
function settleWeb(isUp: boolean) {
  const waiters = web.waiters
  web.waiters = []
  for (const waiter of waiters) waiter(isUp)
}

/** Asks the supervisor for a server. */
function askWeb() {
  web.isAsked = true
  const wake = web.wake
  web.wake = undefined
  wake?.()
}

/** The data changed: the web deck's state is written within 300 ms while it is on; changes meanwhile ride along. */
function scheduleWeb($: EngineInterface) {
  if (!web.isOn || web.dir === '' || timers.web) return
  timers.web = $.clock.after(W.WEB_WRITE_MS, () => {
    timers.web = undefined
    void writeWeb($)
  })
}

/**
 * Writes what the page reads: each edit's patch not written yet
 * (`patches/<id>.diff`, once), then `state.json`, unless it says what the
 * last write said (its time aside). One write at a time: a change during one
 * writes again after it.
 */
async function writeWeb($: EngineInterface): Promise<void> {
  if (!web.isOn || web.dir === '') return
  if (web.isWriting) {
    web.isWriteQueued = true
    return
  }
  web.isWriting = true
  try {
    for (const patch of W.newPatchesOf(data, web.written)) {
      await $.fs.write(`${web.dir}/patches/${patch.id}.diff`, patch.text)
      web.written.add(patch.id)
    }
    const now = await $.clock.now()
    const text = JSON.stringify(W.webStateOf(data, view, git, usage, now, sessionId, cwd))
    const key = text.replace(/^\{"v":1,"now":\d+,/, '')
    if (key !== web.lastKey) {
      await $.fs.write(`${web.dir}/state.json`, text)
      web.lastKey = key
    }
  } catch {
    // a write that failed waits for the next change
  } finally {
    web.isWriting = false
    if (web.isWriteQueued) {
      web.isWriteQueued = false
      scheduleWeb($)
    }
  }
}

/** The session's own process id, read as the parent of a node it starts (no shell between); '' when node cannot say. */
async function enginePidOf($: EngineInterface): Promise<string> {
  try {
    const ran = await $.process.run(['node', '-p', 'process.ppid'], { timeoutMs: 10_000 })
    const pid = ran.stdout.trim()
    return ran.exitCode === 0 && /^\d+$/.test(pid) ? pid : ''
  } catch {
    return ''
  }
}

/**
 * The session's web deck, for as long as this session.start is the latest:
 * picks up what `$.state` kept (a reload while it was on asks for the server
 * again, with its token and port), then runs the server each time it is asked.
 */
async function superviseWeb($: EngineInterface, epoch: number): Promise<void> {
  try {
    const { value } = await $.state.get(WEB_STATE)
    if (value && value.isOn === true && typeof value.token === 'string' && value.token !== '' && epoch === web.epoch) {
      web.isOn = true
      web.token = value.token
      web.port = typeof value.port === 'number' && value.port > 0 ? value.port : 0
      if (typeof value.dir === 'string' && value.dir !== '') web.dir = value.dir
      web.status = 'starting'
      web.isAsked = true
    }
  } catch {
    // nothing kept: the web deck waits for /deck web
  }
  while (epoch === web.epoch) {
    if (!web.isAsked) {
      await new Promise<void>(resolve => {
        web.wake = resolve
      })
      continue
    }
    web.isAsked = false
    await runWeb($, epoch)
  }
}

/** How one run of the server went: whether it said it was ready, whether node was missing, and the last thing it said of why it ended. */
type WebRun = { isReady: boolean; isMissing: boolean; why: string }

/**
 * Runs the server until it ends: the state is written first (the page's
 * first load finds it), the session's pid read for `--parent`, then `node
 * web/server.js` starts with the token in its environment. A restart on a
 * kept port that never comes up is tried once more on a port the OS picks.
 */
async function runWeb($: EngineInterface, epoch: number): Promise<void> {
  const root = $.plugin.root.replace(/[\\/]+$/, '')
  const script = `${root}/web/server.js`
  web.status = 'starting'
  web.note = ''
  if (web.dir === '') web.dir = W.webDirOf(root, sessionId)
  if (web.token === '') web.token = crypto.randomUUID()
  saveWeb($)
  redraw($)
  web.lastKey = ''
  await writeWeb($)
  if (web.pid === '') web.pid = await enginePidOf($)
  // a newer session.start took over: the web deck is its supervisor's now
  if (epoch !== web.epoch) return
  // stopped while it was being readied: nothing to start
  if (!web.isOn) {
    web.status = 'off'
    settleWeb(false)
    redraw($)
    return
  }
  web.keptPort = web.port
  let ran = await spawnWeb($, W.serverArgvOf(script, web.dir, web.pid, web.port))
  if (!ran.isReady && !ran.isMissing && web.port > 0 && web.isOn && epoch === web.epoch) {
    web.port = 0
    ran = await spawnWeb($, W.serverArgvOf(script, web.dir, web.pid, 0))
  }
  web.keptPort = 0
  if (epoch !== web.epoch) return
  if (!web.isOn) {
    web.status = 'off'
  } else if (ran.isMissing) {
    // no node: the deck stays native
    web.isOn = false
    web.status = 'failed'
    web.note = 'Node.js was not found on PATH, so the dashboard cannot start.'
    saveWeb($)
    $.ui.toast('Agent Deck web needs Node.js on PATH; the deck stays in its pane.')
  } else {
    web.status = 'failed'
    web.note = ran.isReady
      ? `The dashboard's server stopped${ran.why ? ` (${ran.why})` : ''}; Open dashboard starts it again.`
      : `The dashboard's server did not start${ran.why ? ` (${ran.why})` : ''}.`
  }
  settleWeb(false)
  redraw($)
}

/** The last line a stream said, on one row. */
function lastLineOf(text: string): string {
  const lines = text
    .split('\n')
    .map(line => F.oneLine(line))
    .filter(line => line !== '')
  return F.trunc(lines[lines.length - 1] ?? '', 200)
}

/**
 * One run of the server: its stdout read line by line as it comes (a chunk
 * may cut a line or hold several; `W.splitLines` holds the rest), its stderr
 * kept for why it ended, until the child ends or `web.stop` ends the loop.
 * Rejects never: a start that fails (no node) is a run that says so.
 */
async function spawnWeb($: EngineInterface, argv: readonly string[]): Promise<WebRun> {
  let rest = ''
  let isReady = false
  let errors = ''
  let stop: (() => void) | undefined
  try {
    const child = $.process.spawn({ argv, env: { AGENT_DECK_TOKEN: web.token } })
    stop = () => {
      void child.return({ code: null, signal: null }).catch(() => undefined)
    }
    web.stop = stop
    for await (const chunk of child) {
      if (chunk.stream === 'stderr') {
        errors = `${errors}${chunk.text}`.slice(-2000)
        continue
      }
      const cut = W.splitLines(rest, chunk.text)
      rest = cut.rest
      for (const line of cut.lines) {
        try {
          if (onWebLine($, line)) isReady = true
        } catch {
          // a line the deck could not act on is let go: the loop reads on
        }
      }
    }
    return { isReady, isMissing: false, why: lastLineOf(errors) }
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error)
    return { isReady, isMissing: !isReady && /ENOENT|not found|failed to start/i.test(said), why: F.trunc(F.oneLine(said), 200) }
  } finally {
    // a newer run's handle stays
    if (web.stop === stop) web.stop = undefined
  }
}

/**
 * A whole line from the server: its ready line (the port it listens on), or
 * a command from the page, checked against the model (`W.routeOf`) and acted
 * on: `chat` through `sendChat`, `review` into the prompt box. Anything else
 * is ignored. Answers whether it was the ready line.
 */
function onWebLine($: EngineInterface, line: string): boolean {
  const said = W.parseLine(line)
  if (said === null) return false
  if (said.kind === 'ready') {
    const kept = web.keptPort
    web.keptPort = 0
    web.port = said.port
    web.status = 'running'
    web.note = ''
    saveWeb($)
    settleWeb(true)
    // the page open before a reload knows the old port only
    if (kept > 0 && kept !== said.port) $.ui.toast('Agent Deck web started again on another port: /deck web gives its new link.')
    redraw($)
    return true
  }
  const route = W.routeOf(said.cmd, data)
  if (route?.kind === 'chat') void sendChat($, route.agentId, route.text)
  else if (route?.kind === 'review') fillReview($, route.text)
  return false
}

/** Starts the web deck when it is not running, and waits (10 s at most) for its server to be up. */
async function ensureWeb($: EngineInterface): Promise<boolean> {
  if (web.status === 'running' && web.port > 0) return true
  const isStarting = web.isOn && web.status === 'starting'
  web.isOn = true
  if (!isStarting) {
    web.status = 'starting'
    web.note = ''
    web.opened = ''
    redraw($)
    askWeb()
  }
  return new Promise<boolean>(resolve => {
    let isDone = false
    const finish = (isUp: boolean) => {
      if (isDone) return
      isDone = true
      timer.cancel()
      resolve(isUp)
    }
    const timer = $.clock.after(WEB_START_MS, () => finish(false))
    web.waiters.push(finish)
  })
}

/** Opens `url` in the Desktop's Browser pane: its server's preview_start over MCP (by either spelling of its name), else as a tool call; false when none takes it. */
async function openInBrowser($: EngineInterface, url: string): Promise<boolean> {
  try {
    const opened = await $.mcp.call('Claude_Browser', 'preview_start', { url })
    if (opened.isError !== true) return true
  } catch {
    // not by that name
  }
  try {
    const opened = await $.mcp.call('Claude Browser', 'preview_start', { url })
    if (opened.isError !== true) return true
  } catch {
    // no Browser pane over MCP (a terminal, a headless run)
  }
  try {
    const called = await $.tool.call({ tool: 'mcp__Claude_Browser__preview_start', url } as unknown as Parameters<EngineInterface['tool']['call']>[0])
    return called.deny === undefined && called.isError !== true
  } catch {
    return false
  }
}

/** Tries the Browser pane with the page; the pane shows the link when that fails. */
async function showWeb($: EngineInterface, url: string): Promise<void> {
  const isOpened = await openInBrowser($, url)
  web.opened = isOpened ? 'opened' : 'failed'
  redraw($)
}

/**
 * `/deck web` and the pane's Open dashboard: starts the web deck if it is
 * not running, then tries to open the page in the Browser pane (left to run:
 * the answer carries the link either way, and the model's context too, so
 * Claude can open it when asked). Without node the deck stays native.
 */
async function openWeb($: EngineInterface): Promise<CommandRunResult> {
  const isUp = await ensureWeb($)
  if (!isUp) {
    const why = web.status === 'starting' ? "The dashboard's server did not answer within 10 s." : web.note || "The dashboard's server did not start."
    $.ui.toast(`Agent Deck web: ${why}`)
    return { text: `${why} The deck stays in its pane: /deck.` }
  }
  const url = W.webUrlOf(web.port, web.token)
  void showWeb($, url)
  return {
    text: `[Open Agent Deck](${url}) in the Browser pane`,
    context: [`The Agent Deck dashboard of this session runs at ${url} (on this machine only; t is its access token). When the user asks to see it, open that URL in the Browser pane (preview_start with url).`],
  }
}

/** `/deck web stop`: the server ends, the state is no longer written, and the next start makes a new link. Answers whether it was on. */
function stopWeb($: EngineInterface): boolean {
  const wasOn = web.isOn || web.status === 'running' || web.status === 'starting'
  web.isOn = false
  web.isAsked = false
  web.token = ''
  web.port = 0
  web.keptPort = 0
  web.status = 'off'
  web.note = ''
  web.opened = ''
  timers.web?.cancel()
  timers.web = undefined
  saveWeb($)
  web.stop?.()
  settleWeb(false)
  redraw($)
  return wasOn
}

/** Puts a review request in the prompt box, for the person to send. */
function fillReview($: EngineInterface, text: string) {
  void $.prompt
    .fill({ text, mode: 'replace' })
    .then(filled => $.ui.toast(filled.isFilled ? 'The review request is in your prompt; press Enter to send it.' : 'Could not fill the prompt.'))
    .catch(() => $.ui.toast('Could not fill the prompt.'))
}

async function restore($: EngineInterface, now: number): Promise<boolean> {
  try {
    const { value } = await $.state.get(SNAPSHOT)
    if (value && value.v === M.SNAPSHOT_VERSION) {
      data = M.healData(M.copyOf(value.data), now)
      // healView builds a fresh view from the snapshot's fields: one missing or unknown takes its default
      view = M.healView(value.view, data)
      return true
    }
  } catch {
    // a missing or unreadable snapshot starts the deck over
  }
  return false
}

const REPO_PIN = { plugin: 'agent-deck', key: 'repo' } as const

/** Which repository each directory agents edit in belongs to, and the one the deck follows. */
let book: R.RepoBook = R.emptyBook()
/** The pin as `$.state` holds it. */
let savedPin = ''
/** The root the edits' display paths are made against; null until the first look. */
let shownRoot: string | null = null

/** Runs git in `where`, the repository shown unless told otherwise; with none, runs nothing. */
async function runGit($: EngineInterface, args: readonly string[], timeoutMs = 15_000, where = git.root): Promise<{ ok: boolean; out: string; err: string }> {
  if (!where) return { ok: false, out: '', err: 'not in a git repository' }
  try {
    const ran = await $.process.run(args, { cwd: where, env: G.GIT_ENV, timeoutMs })
    return { ok: ran.exitCode === 0, out: ran.stdout, err: ran.stderr }
  } catch (error) {
    return { ok: false, out: '', err: error instanceof Error ? error.message : String(error) }
  }
}

/** The root of the repository holding `dir` as git spells it; null outside one, or where git cannot run. */
async function probeRoot($: EngineInterface, dir: string): Promise<string | null> {
  const ran = await runGit($, G.argv.toplevel, 10_000, dir || '.')
  return (ran.ok && R.rootOf(ran.out)) || null
}

/** Probes what the book has not seen yet (the session's directory, a kept pin, each new edited directory), four at a time. */
async function discoverRepos($: EngineInterface): Promise<void> {
  const probes = R.probesOf(book)
  for (let i = 0; i < probes.length; i += 4) {
    await Promise.all(probes.slice(i, i + 4).map(async probe => R.settle(book, probe, await probeRoot($, probe.dir))))
  }
}

/** Keeps the pin in `$.state`, so a reload of the deck keeps it too. */
function savePin($: EngineInterface) {
  if (book.pinned === savedPin) return
  savedPin = book.pinned
  void $.state.set(REPO_PIN, book.pinned).catch(() => undefined)
}

/** Starts following the work: the session's repository, the ones restored edits lie in, and a pin kept from before a reload. */
async function startRepos($: EngineInterface): Promise<void> {
  R.setCwd(book, cwd)
  for (const edit of data.edits) R.noteEdit(book, edit.abs, edit.at)
  try {
    const { value } = await $.state.get(REPO_PIN)
    if (typeof value === 'string') {
      book.pinned = value
      savedPin = value
    }
  } catch {
    // no pin kept: the deck follows the work
  }
  await refreshGit($, true)
}

/**
 * Pins the deck to the repository holding `root` (a root from `git.repos`,
 * or any directory inside a repository); '' lets it follow the work again:
 * the repository an agent edited last, else the session's own.
 */
async function chooseRepo($: EngineInterface, root: string): Promise<void> {
  const wanted = root.trim()
  let pin = ''
  if (wanted) {
    const known = R.lookup(book, wanted)
    pin = (known === undefined ? await probeRoot($, wanted) : known) ?? ''
    if (!pin) {
      $.ui.toast(`Not in a git repository: ${wanted}`)
      return
    }
    if (known === undefined) R.settleDir(book, wanted, pin)
  }
  book.pinned = pin
  savePin($)
  git = { ...git, pinned: pin, repos: R.repoList(book) }
  redraw($)
  await refreshGit($, true)
}

/**
 * Moves the deck to the repository at `root` ('' for none): the file and
 * commit open in the last one close, and edits read from the new root.
 */
function switchRepo($: EngineInterface, root: string) {
  const from = shownRoot ?? R.rootOfEdits(data.edits)
  if (shownRoot !== null || (from !== '' && !R.sameRoot(from, root))) {
    fileDiff = null
    commit = null
    view.file = ''
    view.commit = ''
  }
  for (const edit of data.edits) edit.path = M.relOf(edit.abs, root || null)
  for (const file of Object.values(data.files)) file.path = M.relOf(file.abs, root || null)
  for (const agent of data.agents) agent.files = [...new Set(agent.files.map(path => R.rerootPath(path, from, root)))]
  shownRoot = root
  lastHeavyAt = 0
  git = { ...G.emptyGit(), root, repos: R.repoList(book), pinned: book.pinned }
  save($)
}

function joinPath(root: string, rel: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${rel}`
}

async function lineCountOf($: EngineInterface, abs: string): Promise<number | null> {
  try {
    const stat = await $.fs.stat(abs)
    if (stat.kind !== 'file' || stat.size > 1_000_000) return null
    const text = await $.fs.read(abs)
    if (text.includes('\u0000')) return null
    if (text === '') return 0
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  } catch {
    return null
  }
}

function scheduleGit($: EngineInterface, ms: number, isHeavy = false) {
  isHeavyQueued ||= isHeavy
  timers.git?.cancel()
  timers.git = $.clock.after(ms, () => {
    timers.git = undefined
    const heavy = isHeavyQueued
    isHeavyQueued = false
    void refreshGit($, heavy)
  })
}

/**
 * Reads the repository the deck follows (after probing any directory agents
 * newly edited in): branch, uncommitted files with counts, and (when HEAD
 * moved) the log and day totals.
 */
async function refreshGit($: EngineInterface, isHeavy = false): Promise<void> {
  if (isGitBusy) {
    isGitQueued = true
    isHeavyQueued ||= isHeavy
    return
  }
  isGitBusy = true

  try {
    await discoverRepos($)
    const now = await $.clock.now()
    const root = R.activeRoot(book)
    if (shownRoot === null || !R.sameRoot(root, shownRoot)) switchRepo($, root)
    const repos = R.repoList(book)

    if (!root) {
      git = { ...G.emptyGit(), isRepo: false, checkedAt: now, repos, pinned: book.pinned }
      return
    }

    const run = (args: readonly string[]) => runGit($, args, 15_000, root)
    const [branch, head, status] = await Promise.all([run(G.argv.branch), run(G.argv.head), run(G.argv.status)])

    if (!status.ok) {
      if (!R.sameRoot((await probeRoot($, root)) ?? '', root)) {
        // gone: follow the work to another repository, if any
        R.dropRepo(book, root)
        isGitQueued = true
      }
      git = { ...G.emptyGit(), root, isRepo: false, checkedAt: now, error: F.trunc(status.err.trim(), 200), repos: R.repoList(book), pinned: book.pinned }
      return
    }

    const headHash = head.ok ? head.out.trim() : ''
    const numstat = await run(G.argv.numstat(headHash ? 'HEAD' : G.EMPTY_TREE))
    const rows = G.parseStatus(status.out)
    const untracked = new Map<string, number>()
    await Promise.all(
      rows
        .filter(row => row.x === '?')
        .slice(0, 30)
        .map(async row => {
          const lines = await lineCountOf($, joinPath(root, row.path))
          if (lines !== null) untracked.set(row.path, lines)
        }),
    )

    const files = G.filesOf(rows, G.parseNumstat(numstat.out), untracked)
    const next: G.GitState = {
      ...git,
      isRepo: true,
      branch: branch.ok ? branch.out.trim() : '',
      head: headHash,
      files,
      added: files.reduce((sum, file) => sum + file.added, 0),
      removed: files.reduce((sum, file) => sum + file.removed, 0),
      checkedAt: now,
      repos,
      pinned: book.pinned,
    }

    const isMoved = headHash !== git.head
    if (isMoved || isHeavy || now - lastHeavyAt > 60_000) {
      lastHeavyAt = now
      const [log, upstream, aheadBehind, todayCount, todayStat, sessionCount] = await Promise.all([
        run(G.argv.log(30)),
        run(G.argv.upstream),
        run(G.argv.aheadBehind),
        run(G.argv.countSince('midnight')),
        run(G.argv.statSince('midnight')),
        run(G.argv.countSince(G.sinceOf(data.startedAt - 60_000))),
      ])
      const [behind = 0, ahead = 0] = aheadBehind.ok ? aheadBehind.out.trim().split(/\s+/).map(Number) : [0, 0]
      next.commits = log.ok ? G.parseLog(log.out) : []
      next.upstream = upstream.ok ? upstream.out.trim() : ''
      next.ahead = Number.isFinite(ahead) ? ahead : 0
      next.behind = Number.isFinite(behind) ? behind : 0
      next.today = { commits: todayCount.ok ? Number(todayCount.out.trim()) || 0 : 0, ...(todayStat.ok ? G.sumShortstats(todayStat.out) : { added: 0, removed: 0 }) }
      next.sessionCommits = sessionCount.ok ? Number(sessionCount.out.trim()) || 0 : 0
    }

    git = next
    if (view.file && view.tab === 'changes') void loadFileDiff($, view.file)
  } finally {
    isGitBusy = false
    savePin($)
    lastGitAt = await $.clock.now()
    redrawIfChanged($, lastGitAt)
    if (isGitQueued) {
      isGitQueued = false
      scheduleGit($, 300)
    }
  }
}

async function loadFileDiff($: EngineInterface, path: string): Promise<void> {
  const { root, head } = git
  const row = git.files.find(file => file.path === path)
  const now = await $.clock.now()
  let found: G.FileDiff

  if (!row) {
    found = { path, hunks: [], isBinary: false, note: 'This file has no uncommitted changes any more.', at: now }
  } else if (row.isUntracked) {
    try {
      const abs = joinPath(root, path)
      const stat = await $.fs.stat(abs)
      if (stat.size > 2_000_000) {
        found = { path, hunks: [], isBinary: false, note: `New file, ${Math.round(stat.size / 1024)} KB: too big to show.`, at: now }
      } else {
        const text = await $.fs.read(abs)
        found = text.includes('\u0000') ? { path, hunks: [], isBinary: true, at: now } : { path, hunks: addedFileHunks(text), isBinary: false, at: now }
      }
    } catch {
      found = { path, hunks: [], isBinary: false, note: 'Could not read this new file.', at: now }
    }
  } else {
    const paths = row.oldPath ? [row.oldPath, path] : [path]
    const ran = await runGit($, G.argv.fileDiff(head ? 'HEAD' : G.EMPTY_TREE, paths), 15_000, root)
    found = {
      path,
      hunks: hunksOf(ran.out),
      isBinary: /^Binary files /m.test(ran.out),
      at: now,
      ...(ran.ok ? {} : { note: F.trunc(ran.err.trim() || 'git diff failed', 200) }),
    }
  }

  // a diff read in the repository the deck has since left stays unshown
  if (!R.sameRoot(root, git.root)) return
  const isSame = fileDiff !== null && sameFileDiff(fileDiff, found)
  fileDiff = found
  if (!isSame) redraw($)
}

/** Whether two reads of a file's diff show the same; when each was read does not count. */
function sameFileDiff(a: G.FileDiff, b: G.FileDiff): boolean {
  return a.path === b.path && a.isBinary === b.isBinary && a.note === b.note && JSON.stringify(a.hunks) === JSON.stringify(b.hunks)
}

async function loadCommit($: EngineInterface, hash: string): Promise<void> {
  const root = git.root
  const [meta, numstat, patch] = await Promise.all([
    runGit($, G.argv.showMeta(hash), 15_000, root),
    runGit($, G.argv.showNumstat(hash), 15_000, root),
    runGit($, G.argv.showPatch(hash), 30_000, root),
  ])

  if (view.commit !== hash || !R.sameRoot(root, git.root)) return
  if (!meta.ok) {
    commit = null
    $.ui.toast(`Could not read commit ${hash.slice(0, 7)}`)
    return
  }

  const cap = 160_000
  commit = {
    ...G.parseMeta(meta.out),
    hash,
    files: G.parseNumstat(numstat.out),
    patch: patch.out.slice(0, cap),
    isPatchCut: patch.out.length > cap,
  }
  redraw($)
}

/** Turns an agent's (or the main loop's) transcript into chat bubbles. */
function chatLinesOf(messages: readonly SessionMessage[], agentName: string, parentName: string): ChatLine[] {
  const lines: ChatLine[] = []
  for (const message of messages) {
    const text = message.text.trim()
    if (message.role === 'user') {
      if (text) lines.push({ role: 'parent', who: parentName, text })
      continue
    }
    if (text) lines.push({ role: 'agent', who: agentName, text })
    const uses = message.toolUses
    uses.slice(0, 3).forEach(use => lines.push({ role: 'tool', who: agentName, text: `${use.tool} ${M.targetOf(use.tool, use.input, git.root || null)}${use.isError ? ' ✗' : ''}` }))
    if (uses.length > 3) lines.push({ role: 'tool', who: agentName, text: `… ${uses.length - 3} more tool calls` })
  }
  return lines.slice(-28)
}

async function loadChat($: EngineInterface, agentId: string): Promise<void> {
  const agent = M.agentOf(data, agentId)
  const now = await $.clock.now()
  if (!agent) return

  let lines: ChatLine[] = []
  try {
    if (agent.kind === 'main') {
      const found = await $.session.messages()
      lines = chatLinesOf(found.slice(-16), 'main', 'You')
    } else if (agent.kind === 'agent' || agent.kind === 'teammate') {
      const found = await $.session.messages({ agentId })
      const parent = agent.parentId ? M.agentOf(data, agent.parentId) : undefined
      lines = 'deny' in found ? [{ role: 'note', who: '', text: `No transcript to show yet (${found.deny}).` }] : chatLinesOf(found.slice(-18), M.labelOf(agent), parent ? M.labelOf(parent) : 'main')
    } else {
      lines = data.messages
        .filter(message => message.from === agentId || message.to === agentId)
        .slice(-12)
        .map(message => ({ role: message.from === agentId ? 'agent' : 'parent', who: message.from === agentId ? M.labelOf(agent) : message.from, text: message.text }))
    }
  } catch (error) {
    lines = [{ role: 'note', who: '', text: `Could not read the conversation: ${error instanceof Error ? error.message : String(error)}` }]
  }

  const mine = data.messages.filter(message => message.kind === 'chat' && message.to === agentId && message.at > now - 120_000)
  for (const message of mine) {
    if (!lines.some(line => line.role === 'parent' && line.text.includes(message.text.slice(0, 40)))) lines.push({ role: 'parent', who: 'You (deck)', text: message.text })
  }

  const isSame = chat !== null && chat.agent === agentId && JSON.stringify(chat.lines) === JSON.stringify(lines)
  chat = { agent: agentId, lines, at: now }
  if (!isSame) redraw($)
}

async function sendChat($: EngineInterface, agentId: string, text: string): Promise<void> {
  const agent = M.agentOf(data, agentId)
  const now = await $.clock.now()
  if (!agent) return

  if (agent.kind === 'main') {
    $.ui.toast('Queued for the main loop; it runs when the current turn ends.')
    void $.prompt.submit({ text, asUser: true }).catch(error => $.ui.toast(`Could not queue the prompt: ${String(error)}`))
    chat?.lines.push({ role: 'parent', who: 'You', text })
    redraw($)
    return
  }

  const sent = await $.session.send({ to: { agentId }, text }).catch(error => ({ isDelivered: false as const, reason: String(error) }))
  M.addMessage(data, { from: M.YOU, to: agentId, kind: 'chat', text, at: now, isDelivered: sent.isDelivered })
  if (chat?.agent === agentId) chat.lines.push({ role: 'parent', who: 'You (deck)', text })
  if (sent.isDelivered) {
    $.ui.toast(`Sent to ${M.labelOf(agent)}`)
    if (M.isEnded(agent.status)) M.reopen(agent)
  } else {
    $.ui.toast(`Not delivered: ${sent.reason}`)
  }
  save($)
  redraw($)
}

function usageOf(raw: Awaited<ReturnType<EngineInterface['session']['usage']>>): UsageInfo {
  return {
    startedAt: raw.startedAt,
    ...(raw.context.percent !== undefined ? { contextPercent: raw.context.percent } : {}),
    ...(raw.cost ? { costUsd: raw.cost.usd } : {}),
    limits: raw.rateLimits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed })),
  }
}

async function loadUsage($: EngineInterface): Promise<void> {
  try {
    usage = usageOf(await $.session.usage())
    usageAt = await $.clock.now()
    redrawIfChanged($, usageAt)
  } catch {
    // the status line's figures are optional here
  }
}

function historyOf(value: unknown): History {
  return value && typeof value === 'object' ? (value as History) : {}
}

/** Adds this session's totals to the day it started, kept across sessions in `$.store`. */
async function recordDay($: EngineInterface): Promise<void> {
  const totals = M.totalsOf(data)
  const day = F.dayKey(data.startedAt)
  const key = `${sessionId || 'session'}:${data.startedAt}`
  try {
    const history = M.copyOf(historyOf(await $.store.get(HISTORY_KEY)))
    const today = history[day] ?? {}
    today[key] = {
      added: totals.added,
      removed: totals.removed,
      tools: totals.tools,
      tokens: totals.tokensIn + totals.tokensOut + totals.cacheRead,
      activeMs: data.turnMs,
    }
    history[day] = today
    const cutoff = F.dayKey(data.startedAt - HISTORY_DAYS * 86_400_000)
    for (const old of Object.keys(history)) if (old < cutoff) delete history[old]
    await $.store.set(HISTORY_KEY, history)
    days = daysOf(history, await $.clock.now())
  } catch {
    // history is a nicety; the session's own numbers stand without it
  }
}

function daysOf(history: History, now: number): DayRow[] {
  const out: DayRow[] = []
  for (let back = 6; back >= 0; back--) {
    const day = F.dayKey(now - back * 86_400_000)
    const sessions = Object.values(history[day] ?? {})
    out.push({
      day,
      sessions: sessions.length,
      added: sessions.reduce((sum, one) => sum + (one.added ?? 0), 0),
      removed: sessions.reduce((sum, one) => sum + (one.removed ?? 0), 0),
      tools: sessions.reduce((sum, one) => sum + (one.tools ?? 0), 0),
      tokens: sessions.reduce((sum, one) => sum + (one.tokens ?? 0), 0),
      activeMs: sessions.reduce((sum, one) => sum + (one.activeMs ?? 0), 0),
    })
  }
  return out.some(row => row.sessions > 0) ? out : []
}

async function loadDays($: EngineInterface): Promise<void> {
  try {
    const now = await $.clock.now()
    days = daysOf(historyOf(await $.store.get(HISTORY_KEY)), now)
    daysAt = now
    redrawIfChanged($, now)
  } catch {
    days = []
  }
}

/** Folds in what the engine lists: agents spawned before this module loaded, and each one's status. */
async function syncAgents($: EngineInterface): Promise<void> {
  let list: AgentInfo[]
  try {
    list = await $.agent.list()
  } catch {
    return
  }
  const now = await $.clock.now()
  let isChanged = false

  for (const info of list) {
    const isKnown = M.agentOf(data, info.id) !== undefined
    // the engine lists subagents and teammates alone: a row taken for housekeeping is a real agent
    const agent = M.ensureAgent(data, info.id, now, info.teammateId ? 'teammate' : 'agent')
    if (!isKnown) isChanged = true
    if (info.teammateId) agent.kind = 'teammate'
    if (agent.origin === 'engine' || agent.origin === undefined) agent.origin = agent.kind === 'teammate' ? 'teammate' : 'agent'
    if (info.description && !agent.description) agent.description = info.description
    if (info.type && (agent.type === 'subagent' || agent.type === '')) agent.type = info.type
    if (info.name && M.isNameless(agent)) agent.name = info.name
    if (info.parentId && (agent.parentId === undefined || agent.parentId === M.MAIN) && M.agentOf(data, info.parentId)) agent.parentId = info.parentId
    M.fixLabel(data, agent)
    const status = info.status as DeckStatus
    // a row the deck ended (its turn, SubagentStop, TeammateIdle) is not woken by a list that lags: its own next call does that
    const isEndedHere = agent.endedAt !== undefined && !M.isLive(agent.status) && M.isLive(status)
    if (agent.status !== status && !isEndedHere) {
      agent.status = status
      if (M.isEnded(status)) {
        agent.endedAt ??= now
        delete agent.current
        delete agent.todo
      }
      isChanged = true
    }
  }

  if (isChanged) touched($, now)
}

/** The most agents' transcripts one recovery pass reads. */
const RECOVER_MOST = 12

/**
 * Recovery's own state: a pass under way, the agents whose transcripts were
 * read (each once while this module runs), and whether the pane's first tick
 * has looked yet (it looks again each time the pane opens).
 */
const recovery = { isBusy: false, isPaneSeen: false, tried: new Set<string>() }

/**
 * Reads back what a reload can cost the deck. With no goal in hand, the
 * person's newest prompt in their own words becomes one (`M.recoverGoal`).
 * Each ended agent with no result (at most 12 a pass, the latest to end
 * first) takes the hand-back or last words its own transcript holds, unless
 * the read is denied. Run unawaited from session.start and the pane's first
 * tick, one pass at a time; what it fails at leaves the deck as it was.
 */
async function recoverLost($: EngineInterface): Promise<void> {
  if (recovery.isBusy) return
  recovery.isBusy = true
  try {
    const now = await $.clock.now()
    let isChanged = false
    if (!M.goalOf(data)) {
      try {
        const found = M.recoverGoal(await $.session.messages())
        // a prompt may have started a goal while the transcript was read
        if (found && !M.goalOf(data)) isChanged = M.noteRecoveredGoal(data, found, now) !== undefined
      } catch {
        // no goal recovered: the person's next prompt starts one
      }
    }
    const ids = M.unansweredOf(data)
      .map(agent => agent.id)
      .filter(id => !recovery.tried.has(id))
      .slice(0, RECOVER_MOST)
    for (const id of ids) {
      recovery.tried.add(id)
      try {
        const found = await $.session.messages({ agentId: id })
        const result = Array.isArray(found) ? M.recoverResult(found) : undefined
        // the row as it stands now: a result that came meanwhile stays
        const agent = M.agentOf(data, id)
        if (result && agent && M.isEnded(agent.status) && !agent.answer) isChanged = M.noteResult(data, agent, result.text, agent.endedAt ?? now, result.via) || isChanged
      } catch {
        // that agent stays without a result
      }
    }
    if (isChanged) changed($)
  } catch {
    // recovery is a nicety: the deck goes on as it was
  } finally {
    recovery.isBusy = false
  }
}

/**
 * Every 2.5 seconds: folds in the agents' statuses and, while the pane is
 * open or the web deck is on, re-reads git and usage in the background (the
 * pane's history too). It draws only when the screen would change
 * (`redrawIfChanged`, the web deck's signal as well); events draw for themselves.
 */
async function tick($: EngineInterface): Promise<void> {
  await checkDebug($)
  const now = await $.clock.now()
  // workflow agents and housekeeping loops fold away: they keep nothing on screen live
  const isAnyLive = M.hasLiveAgents(data)
  if (isAnyLive || isPaneOpen || web.isOn) await syncAgents($)
  if (isPaneOpen || web.isOn) {
    if (now - lastGitAt > 6000) void refreshGit($)
    if (now - usageAt > 10_000) void loadUsage($)
  }
  if (isPaneOpen) {
    if (now - daysAt > 120_000) void loadDays($)
    if (view.tab === 'agents' && view.agentPane === 'chat' && now - (chat?.at ?? 0) > 6000) void loadChat($, view.agent)
  }
  // the pane's first tick looks again for what a reload lost (once a pass under way is done)
  if (!isPaneOpen) {
    recovery.isPaneSeen = false
  } else if (!recovery.isPaneSeen && !recovery.isBusy) {
    recovery.isPaneSeen = true
    void recoverLost($)
  }
  // with the pane shut, no agent at work and no web deck nothing of the deck's is on screen: the next event draws
  if (isPaneOpen || isAnyLive || web.isOn) redrawIfChanged($, now)
}

async function openPane($: EngineInterface): Promise<boolean> {
  const opened = await $.ui.open({ id: PANE, title: 'Agent Deck', focus: true, columns: 84 })
  isPaneOpen = true
  void refreshGit($, true)
  void loadUsage($)
  void loadDays($)
  void syncAgents($)
  if (view.tab === 'agents' && view.agentPane === 'chat') void loadChat($, view.agent)
  if (view.commit) void loadCommit($, view.commit)
  return opened.isPlaced
}

function changed($: EngineInterface) {
  save($)
  redraw($)
}

/** Opens row `id` (an agent, a plan step, a file) in the detail block; an agent's conversation reloads when that view is the one open. */
function pickAgent($: EngineInterface, id: string) {
  view.agent = id
  chat = null
  if (view.agentPane === 'chat') void loadChat($, id)
}

/** The closures the views' buttons and fields run. */
function actionsFor($: EngineInterface): Actions {
  return {
    setTab: tab => {
      view.tab = tab
      if (tab === 'agents' && view.agentPane === 'chat') void loadChat($, view.agent)
      if (tab === 'changes' && view.file) void loadFileDiff($, view.file)
      changed($)
    },
    select: id => {
      pickAgent($, id)
      // the outline shows what was picked: out of a zoom it lies outside, the branches above it opened
      const shown = O.revealed(data, view, id)
      view.folded = shown.folded
      view.zoom = shown.zoom
      changed($)
    },
    toggleFold: id => {
      view.folded = O.foldToggled(data, view, id)
      changed($)
    },
    zoomTo: id => {
      // zooming on the branch already zoomed comes back out: the detail's Zoom and the outline's z both toggle
      view.zoom = id !== '' && id === view.zoom ? '' : O.zoomFor(data, view, id)
      changed($)
    },
    selectAgent: id => {
      pickAgent($, id)
      changed($)
    },
    selectRepo: root => void chooseRepo($, root),
    setAgentPane: pane => {
      view.agentPane = pane
      if (pane === 'chat') void loadChat($, view.agent)
      changed($)
    },
    selectFile: path => {
      view.file = view.file === path ? '' : path
      fileDiff = null
      if (view.file && git.isRepo) void loadFileDiff($, path)
      changed($)
    },
    selectCommit: hash => {
      view.commit = view.commit === hash ? '' : hash
      commit = null
      if (view.commit) void loadCommit($, hash)
      changed($)
    },
    setFilter: filter => {
      view.filter = filter
      changed($)
    },
    toggleFiles: () => {
      view.showFiles = !view.showFiles
      changed($)
    },
    toggleBand: () => {
      view.isBandHidden = !view.isBandHidden
      void $.store.set('prefs', { isBandHidden: view.isBandHidden }).catch(() => undefined)
      changed($)
    },
    refresh: () => {
      void refreshGit($, true)
      void loadUsage($)
      void syncAgents($)
      if (view.tab === 'agents' && view.agentPane === 'chat') void loadChat($, view.agent)
      $.ui.toast('Agent Deck refreshed')
    },
    sendChat: (agentId, text) => void sendChat($, agentId, text),
    review: text => fillReview($, text),
    open: tab => {
      view.tab = tab
      changed($)
      void openPane($)
    },
    openWeb: () => void openWeb($),
    toggleDetails: () => {
      view.isDetailsOpen = !view.isDetailsOpen
      changed($)
    },
    showDetails: id => {
      view.isDetailsOpen = true
      if (id !== '') {
        pickAgent($, id)
        const shown = O.revealed(data, view, id)
        view.folded = shown.folded
        view.zoom = shown.zoom
      }
      changed($)
    },
  }
}

function kitOf(ui: ReturnType<EngineInterface['ui']['resolve']>, surface: Kit['surface'], columns: number): Kit {
  return {
    surface,
    Box: ui.Box,
    Text: ui.Text,
    Button: ui.Button,
    Code: ui.Code,
    Markdown: ui.Markdown,
    columns,
    ...('Input' in ui ? { Input: ui.Input } : {}),
    ...('Select' in ui ? { Select: ui.Select } : {}),
    // the terminal's table answers to Svg but draws nothing for it: there Stats draws its cards and charts as text
    ...('Svg' in ui && surface !== 'terminal' ? { Svg: ui.Svg } : {}),
  }
}

/** The state a drawing reads: the live model, as it is now; the views build their rows from it. */
function modelOf(now: number): DeckModel {
  return {
    data,
    view,
    git,
    fileDiff,
    commit,
    chat: chat && chat.agent === view.agent ? chat.lines : null,
    usage,
    days,
    now,
    cwd,
    web: webPaneOf(),
  }
}

/** The file an Edit, Write or NotebookEdit call names; '' for none. */
function editedPathOf(input: Record<string, unknown>): string {
  return typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
}

/** A tool's `structuredPatch` (or a bashEditDiff file's hunks) as the deck's hunks, each line cleaned. */
function hunksFrom(value: unknown): Hunk[] {
  const patch = Array.isArray(value) ? (value as unknown[]) : []
  return patch
    .filter((hunk): hunk is Record<string, unknown> => typeof hunk === 'object' && hunk !== null)
    .map(hunk => ({
      oldStart: Number(hunk.oldStart) || 0,
      oldLines: Number(hunk.oldLines) || 0,
      newStart: Number(hunk.newStart) || 0,
      newLines: Number(hunk.newLines) || 0,
      lines: Array.isArray(hunk.lines) ? hunk.lines.map(line => F.clean(String(line))) : [],
    }))
}

/**
 * Records exactly what an Edit, Write or NotebookEdit changed, from the
 * tool's own patch, under `abs`, the file's path as the file system spells
 * it (`realPathOf`), so it compares with git's; and whether the person
 * changed the proposed edit before accepting it (`userModified`).
 */
function recordEdit(agent: DeckAgent, tool: string, id: string, input: Record<string, unknown>, ran: ToolCallResult, now: number, abs: string) {
  if (!abs) return
  const record = (ran.result ?? null) as Record<string, unknown> | null
  if (record && record.staged === true) return

  let hunks: Hunk[] = hunksFrom(record?.structuredPatch)
  const isNew = tool === 'Write' && record?.type === 'create'

  if (hunks.length === 0) {
    if (tool === 'Write' && isNew) hunks = addedFileHunks(String(input.content ?? ''))
    else if (tool === 'Edit') hunks = replaceHunks(String(input.old_string ?? ''), String(input.new_string ?? ''))
    else if (tool === 'NotebookEdit') hunks = addedFileHunks(String(input.new_source ?? ''))
  }

  const { added, removed } = countOf(hunks)
  M.addEdit(data, agent, {
    id,
    agent: agent.id,
    tool,
    path: M.relOf(abs, git.root || null),
    abs: M.normPath(abs),
    at: now,
    added,
    removed,
    patch: patchOf(hunks, M.LIMITS.patchChars),
    isNew,
    ...(record?.userModified === true ? { userModified: true } : {}),
  })
  // the next git refresh probes a directory not seen before, and follows the repository edited last
  R.noteEdit(book, abs, now)
}

/**
 * Records the files a Bash command changed, from its result's
 * `bashEditDiff` (feature-detected: an internal field, absent on builds
 * without it, and skipped when it says the diff is unavailable): one edit
 * per file, with that file's exact hunks. Answers how many it recorded.
 */
async function recordShellEdits($: EngineInterface, agent: DeckAgent, tool: string, id: string, ran: ToolCallResult, now: number): Promise<number> {
  const record = (ran.result ?? null) as Record<string, unknown> | null
  const diff = record && typeof record.bashEditDiff === 'object' && record.bashEditDiff !== null ? (record.bashEditDiff as Record<string, unknown>) : null
  if (!diff || diff.unavailable === true || diff.skipped === true || !Array.isArray(diff.files)) return 0
  let count = 0
  for (const file of diff.files as unknown[]) {
    if (typeof file !== 'object' || file === null) continue
    const one = file as Record<string, unknown>
    if (typeof one.filePath !== 'string' || one.filePath === '') continue
    const abs = await realPathOf($, one.filePath)
    const hunks = hunksFrom(one.hunks)
    const { added, removed } = countOf(hunks)
    M.addEdit(data, agent, {
      id: `${id}:${count}`,
      agent: agent.id,
      tool,
      path: M.relOf(abs, git.root || null),
      abs: M.normPath(abs),
      at: now,
      added,
      removed,
      patch: patchOf(hunks, M.LIMITS.patchChars),
      isNew: one.created === true,
    })
    R.noteEdit(book, abs, now)
    count += 1
  }
  return count
}

/** Marks the commits a shell command made as that agent's. */
async function attributeCommits($: EngineInterface, agentId: string, before: string): Promise<void> {
  const ran = await runGit($, before ? G.argv.newSince(before) : G.argv.recentHashes)
  if (!ran.ok) return
  const hashes = ran.out.split('\n').map(line => line.trim()).filter(Boolean)
  const fresh = before ? hashes : hashes.slice(0, 1).filter(hash => hash !== git.head)
  for (const hash of fresh) data.commitsBy[hash] = agentId
  const keys = Object.keys(data.commitsBy)
  if (keys.length > 300) for (const old of keys.slice(0, keys.length - 300)) delete data.commitsBy[old]
  if (fresh.length > 0) scheduleGit($, 200, true)
  save($)
}

/**
 * `/deck probe`: a pane of its own that settles in one look what a surface
 * does with a `Client` (./ui/probe.client.tsx) beside native Text and an
 * Svg. A diagnostic; the deck's screens read none of it.
 */
const PROBE = 'agent-deck-probe'

const probe: {
  /** Bumped every 1500 ms while the pane is open; each bump redraws it, handing the Client new props. */
  tick: number
  timer?: Timer
  /** The last `ui.message` the Client posted, as one line of JSON; '' before the first. */
  message: string
  /** The last `ui.fault` the Client raised. */
  fault: { surface: RenderSurface; phase: string; reason: string } | null
  /** Where the Client failed: those drawings leave it out (no fault loop) until the probe opens again. */
  failedOn: Set<RenderSurface>
} = { tick: 0, message: '', fault: null, failedOn: new Set() }

/** Starts the probe's tick, or restarts it. */
function startProbe($: EngineInterface) {
  probe.timer?.cancel()
  probe.timer = $.clock.every(1500, () => {
    probe.tick += 1
    redraw($)
  })
}

function stopProbe() {
  probe.timer?.cancel()
  probe.timer = undefined
}

/**
 * `/deck probe`: opens the probe afresh with the keyboard (Esc closes it),
 * or closes it while it is open; the `ui.close` hook stops the tick.
 */
async function toggleProbe($: EngineInterface): Promise<CommandRunResult> {
  const panes = await $.ui.panes().catch(() => [])
  if (panes.some(pane => pane.id === PROBE)) {
    await $.ui.close({ id: PROBE })
    return { text: 'Deck probe closed.' }
  }
  probe.tick = 0
  probe.message = ''
  probe.fault = null
  probe.failedOn.clear()
  const opened = await $.ui.open({ id: PROBE, title: 'Deck probe', focus: true, closeOnEscape: true, rows: 24 })
  startProbe($)
  return opened.isPlaced ? {} : { text: 'Deck probe is open and waiting for room: widen the window, or press ctrl+x then tab.' }
}

/** Plain data as one line of JSON, cut to fit a line. */
function jsonLine(value: unknown): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  return F.trunc(F.oneLine(text), 240)
}

/**
 * The probe's Svg: markup far wider than any slot (2400×160 over a 900×60
 * viewBox), graphite ground, one 13px bone label carrying the tick `count`.
 * (No `tick` here: the validator resolves the functions handed `$` by name.)
 */
function probeSvg(count: number): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="160" viewBox="0 0 900 60">',
    `<rect x="0" y="0" width="900" height="60" fill="${T.bg}"/>`,
    `<text x="16" y="35" font-family="${T.fontLabel}" font-size="13" fill="${T.text1}">tick ${count} &#183; this text is 13px</text>`,
    '</svg>',
  ].join('')
}

/**
 * The probe pane, top to bottom: the site's numbers and a hex colour in
 * native Text, the Client, an Svg without `isInteractive`, and the last
 * `ui.message` and `ui.fault` the Client caused. `Client` and `Svg` are
 * passed only where the surface draws them.
 */
function probeView(
  ui: ReturnType<EngineInterface['ui']['resolve']>,
  e: RenderInput<'Pane'>,
  Client: Elements['desktop']['Client'] | undefined,
  Svg: Elements['desktop']['Svg'] | undefined,
): RenderElement {
  const { Box, Text } = ui
  const viewport = e.viewport ? `${e.viewport.columns}×${e.viewport.rows}` : 'none'
  const fault = probe.fault
  let client: RenderElement
  if (!Client) client = <Text dimColor>{`No Client on ${e.surface}: its element table has none.`}</Text>
  else if (probe.failedOn.has(e.surface)) client = <Text dimColor>{`The Client is left out here after its fault; /deck probe twice draws it again.`}</Text>
  else client = <Client key="probe" module="./ui/probe.client.tsx" width="100%" props={{ tick: probe.tick, cols: e.props.bodyColumns }} />
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" columnGap={2}>
        <Text>{`bodyColumns=${e.props.bodyColumns}  viewport=${viewport}  placement=${e.props.placement}  bodyRows=${e.props.scroll.bodyRows}  surface=${e.surface}`}</Text>
        <Text color={T.copper}>copper hex</Text>
      </Box>
      {client}
      {Svg ? (
        <Svg source={probeSvg(probe.tick)} alt={`tick ${probe.tick}: 13px bone text on graphite, markup 2400×160 over a 900×60 viewBox`} />
      ) : (
        <Text dimColor>{`No Svg on ${e.surface}.`}</Text>
      )}
      <Box flexDirection="column">
        <Text dimColor>{`ui.message: ${probe.message || 'none yet'}`}</Text>
        <Text dimColor>{`ui.fault: ${fault ? `${fault.phase} on ${fault.surface}: ${fault.reason}` : 'none'}`}</Text>
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    cwd = e.cwd
    debug.loadedAt = now
    await checkDebug($, true)
    const isRestored = await restore($, now)
    if (!isRestored) {
      data = M.emptyData(now)
      view = M.defaultView()
    }

    try {
      const prefs = await $.store.get('prefs')
      if (prefs && typeof prefs === 'object' && 'isBandHidden' in prefs) view.isBandHidden = Boolean((prefs as { isBandHidden: unknown }).isBandHidden)
    } catch {
      // defaults stand
    }

    try {
      const panes = await $.ui.panes()
      isPaneOpen = panes.some(pane => pane.id === PANE)
      // a reload drops the probe's tick with the old environment: start it again while its pane stays up
      if (panes.some(pane => pane.id === PROBE)) startProbe($)
    } catch {
      isPaneOpen = false
    }

    try {
      sessionId = await $.session.id()
    } catch {
      sessionId = ''
    }

    // the web deck's supervisor, this session.start's: on again at once when a reload found it on
    web.epoch += 1
    const wake = web.wake
    web.wake = undefined
    wake?.()
    web.stop?.()
    void superviseWeb($, web.epoch)

    try {
      const raw = await $.session.usage()
      usage = usageOf(raw)
      usageAt = now
      if (!isRestored) data.startedAt = raw.startedAt
    } catch {
      // the session's start stays the module's first look
    }

    try {
      const main = M.agentOf(data, M.MAIN)
      if (main && !main.model) main.model = await $.session.model()
    } catch {
      // the model shows once a request reports it
    }

    void startRepos($)
    void loadDays($)
    void syncAgents($)
    // what a reload lost (the goal, an ended agent's result), read back from the transcripts: never awaited, it redraws when done
    void recoverLost($)
    timers.tick = $.clock.every(2500, () => void tick($))

    try {
      await $.command.register({
        name: 'deck',
        description: 'Open Agent Deck: who each agent is, what it is doing, how they talk, and the diffs they make (/deck web: the live dashboard in the Browser pane)',
        argumentHint: '[agents|changes|stats|details|web|web stop|band|close|probe]',
        immediate: true,
      })
    } catch (error) {
      $.ui.log(`could not add /deck: ${error instanceof Error ? error.message : String(error)}`)
    }

    return next(e)
  })

  on('session.end', { reason: ['clear', 'resume'] }, async ($, e, next) => {
    const result = await next(e)
    const now = await $.clock.now()
    data = M.emptyData(now)
    chat = null
    commit = null
    fileDiff = null
    changed($)
    return result
  })

  on('command.run', { command: 'deck' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close' || arg === 'off' || arg === 'hide') {
      await $.ui.close({ id: PANE })
      isPaneOpen = false
      return { text: 'Agent Deck closed.' }
    }
    if (arg === 'band') {
      view.isBandHidden = !view.isBandHidden
      void $.store.set('prefs', { isBandHidden: view.isBandHidden }).catch(() => undefined)
      changed($)
      return { text: view.isBandHidden ? 'The agents band above the prompt is hidden. /deck band shows it again.' : 'The agents band shows above the prompt while subagents run.' }
    }
    if (arg === 'probe') return toggleProbe($)
    // the live dashboard: started if need be, its link answered, opened in the Browser pane when it can be
    const words = arg.split(/\s+/)
    if (words[0] === 'web') {
      if (words[1] === 'stop' || words[1] === 'off' || words[1] === 'close') return { text: stopWeb($) ? 'Agent Deck web stopped.' : 'Agent Deck web was not running.' }
      return openWeb($)
    }
    // the Agents tab's full outline
    if (arg === 'details') {
      view.tab = 'agents'
      view.isDetailsOpen = true
    }
    // a tab's name or its start; an earlier build's name (overview, diffs, commits, graph) lands on the tab that replaced it
    const tab = arg === 'details' ? undefined : M.tabFor(arg)
    if (tab) view.tab = tab
    const isPlaced = await openPane($)
    changed($)
    return isPlaced ? {} : { text: 'Agent Deck is open and waiting for room: widen the window, or press ctrl+x then tab.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    isPaneOpen = false
    return result
  })

  // the probe closes by /deck probe, Esc or its close mark: its tick stops
  on('ui.close', { id: PROBE }, async ($, e, next) => {
    const result = await next(e)
    stopProbe()
    return result
  })

  on('tool.call', async ($, e, next) => {
    // the deck's own calls are no agent's work
    if (next.origin.plugin === $.plugin.name) return next(e)
    const start = await $.clock.now()
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const agentId = e.agentId ?? M.MAIN
    const command = typeof input.command === 'string' ? input.command : ''
    const isShell = M.SHELL_TOOLS.includes(tool)
    const isEdit = M.EDIT_TOOLS.includes(tool)
    const isSpawn = tool === 'Agent' || (tool === 'Task' && typeof input.prompt === 'string')
    let agent: DeckAgent | undefined

    try {
      // a loop no spawn named is a workflow's agent while a run is live, else the engine's own
      agent = M.seeLoop(data, agentId, start)
      // a call is work: an ended agent (a message woke it) or an idle teammate runs again
      if (M.isEnded(agent.status) || agent.status === 'idle') M.reopen(agent)
      delete agent.endedAt
      // the agent the engine waited on for the person moved on
      M.clearNeeds(data, { kind: 'start', agent: agentId })
      const file = typeof input.file_path === 'string' ? input.file_path : ''
      const said = file ? { ...input, file_path: knownRealOf(file) } : input
      const activity = M.activityOf(e.tool_use_id, tool, said, git.root || null, start, data.board)
      M.beginTool(data, agent, activity)
      // the call goes on at once; its target follows when the file system spells a new directory
      if (file && !isSpelledOf(file)) void respell($, activity, tool, input, file)
    } catch {
      agent = undefined
    }
    try {
      // an Agent call shows its agent at once, keyed by the call until the spawn binds it
      if (isSpawn) {
        M.addPlaceholder(data, {
          toolUseId: e.tool_use_id,
          parentId: agentId,
          ...(typeof input.name === 'string' ? { name: input.name } : {}),
          description: typeof input.description === 'string' ? input.description : '',
          prompt: typeof input.prompt === 'string' ? input.prompt : '',
          ...(typeof input.subagent_type === 'string' ? { type: input.subagent_type } : {}),
          at: start,
        })
      }
      if (tool === 'Workflow') {
        const meta = typeof input.script === 'string' ? M.workflowMetaOf(input.script) : undefined
        const named = typeof input.name === 'string' ? input.name : ''
        M.noteWorkflow(data, { id: e.tool_use_id, caller: agentId, name: meta?.name || named, phases: meta?.phases ?? [], at: start })
      }
      touched($, start)
    } catch {
      // the call goes ahead whatever the deck makes of it
    }

    const before = isShell && git.isRepo && G.mayCommit(command) ? await runGit($, G.argv.head).then(ran => (ran.ok ? ran.out.trim() : '')) : ''
    const ran = await next(e)

    let end = start
    let ok = false
    try {
      end = await $.clock.now()
      ok = ran.deny === undefined && ran.isError !== true
      if (agent) {
        M.endTool(agent, e.tool_use_id, ok, end)
        // a permission prompt holds its call: the call's end is the person's answer
        M.clearNeeds(data, { kind: 'end', agent: agentId, call: e.tool_use_id })
      }
    } catch {
      // tracking never changes what the tool returned
    }
    const record = ran.result !== null && typeof ran.result === 'object' ? (ran.result as Record<string, unknown>) : null

    // the files it changed, spelled as the file system does (an 8.3 short name made long), so git's paths match
    let shellEdits = 0
    if (ok && agent) {
      try {
        const named = isEdit ? editedPathOf(input) : ''
        if (named) recordEdit(agent, tool, e.tool_use_id, input, ran, end, await realPathOf($, named))
        if (tool === 'Bash') shellEdits = await recordShellEdits($, agent, tool, e.tool_use_id, ran, end)
      } catch {
        // an edit the deck could not read is left out
      }
    }

    // its lists: the whole todo list, and the task board
    if (ok && agent) {
      try {
        if (M.LIST_TOOLS.includes(tool)) M.noteTodo(data, agent, tool, input, ran.result, end)
        if (M.TASK_TOOLS.includes(tool)) M.noteBoard(data, agent, tool, input, ran.result, end)
      } catch {
        // a list the deck could not read is left out
      }
    }

    // an Agent call's row: bound to the agent its result names, or ended when none started; a foreground agent's report
    if (isSpawn) {
      try {
        const status = typeof record?.status === 'string' ? record.status : ''
        const handback = record?.handbackReport
        const report =
          handback && typeof handback === 'object' && typeof (handback as { text?: unknown }).text === 'string'
            ? String((handback as { text: string }).text)
            : Array.isArray(record?.content)
              ? (record.content as unknown[]).map(block => (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : '')).join('\n')
              : ''
        const settled = M.settleAgentCall(data, {
          toolUseId: e.tool_use_id,
          ...(typeof record?.agentId === 'string' && record.agentId !== '' ? { agentId: record.agentId } : {}),
          isStarted: ok,
          why: ran.deny ?? (typeof ran.text === 'string' ? ran.text : ''),
          ...(ok && status === 'completed' && report.trim() !== '' ? { report } : {}),
          isDone: ok && status === 'completed',
          isRemote: status === 'remote_launched',
          at: end,
        })
        if (settled?.from !== undefined) renameInView(settled.from, settled.agent.id)
      } catch {
        // the call's agent stands as its spawn left it
      }
    }

    // an agent's report: SubagentHandback's message, its result whatever its turn's answer says
    if (ok && agent && tool === 'SubagentHandback') {
      try {
        if (typeof input.message === 'string') M.noteResult(data, agent, input.message, end, 'handback')
      } catch {
        // the report stands in the agent's own transcript
      }
    }

    // the plan the person approved
    if (ok && tool === 'ExitPlanMode' && record?.awaitingLeaderApproval !== true) {
      try {
        let plan = typeof record?.plan === 'string' ? record.plan : typeof input.plan === 'string' ? input.plan : ''
        if (plan.trim() === '' && typeof record?.filePath === 'string' && record.filePath !== '') plan = await $.fs.read(record.filePath)
        if (plan.trim() !== '') M.notePlan(data, plan, end)
      } catch {
        // no plan the deck could read
      }
    }

    // a Workflow run's ids, or its end when it never launched; a TaskStop of one ends it
    try {
      if (tool === 'Workflow') {
        const text = (field: string) => (typeof record?.[field] === 'string' ? (record[field] as string) : undefined)
        M.launchWorkflow(data, e.tool_use_id, { ok, at: end, ...(text('runId') ? { runId: text('runId') } : {}), ...(text('taskId') ? { taskId: text('taskId') } : {}), ...(text('workflowName') ? { name: text('workflowName') } : {}) })
      }
      if (ok && tool === 'TaskStop') M.endWorkflows(data, String(input.task_id ?? input.shell_id ?? ''), end)
    } catch {
      // the run stands as it was
    }

    try {
      if (isEdit || shellEdits > 0 || (isShell && G.mayChangeTree(command))) scheduleGit($, 700)
      // a commit the shell reports by its sha is this agent's; else git is asked what is new
      const operation = record?.gitOperation
      const commit = operation && typeof operation === 'object' ? (operation as { commit?: { sha?: unknown } }).commit : undefined
      if (ok && commit && typeof commit.sha === 'string' && commit.sha !== '') {
        data.commitsBy[commit.sha] = agentId
        scheduleGit($, 200, true)
      } else if (isShell && ok && G.mayCommit(command)) {
        void attributeCommits($, agentId, before)
      }
      touched($, end)
    } catch {
      // tracking never changes what the tool returned
    }

    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    try {
      const now = await $.clock.now()
      const parentId = e.parentAgentId ?? M.MAIN
      if (result.agentId) {
        if (parentId !== M.MAIN) M.seeLoop(data, parentId, now)
        // the row its Agent call made takes the agent's id: the same row, never a second one
        const { agent, from } = M.noteSpawn(data, {
          toolUseId: e.tool_use_id,
          agentId: result.agentId,
          parentId,
          ...(e.name ? { name: e.name } : {}),
          description: e.description,
          prompt: e.prompt,
          type: e.subagentType,
          isTeammate: e.isTeammate === true,
          ...(e.workflow ? { workflow: e.workflow.runId } : {}),
          model: result.model,
          at: now,
        })
        if (from !== undefined) renameInView(from, agent.id)
        // a workflow's agents fold into one row: their hand-offs stay in the run
        if (!e.workflow) M.addMessage(data, { from: agent.parentId ?? parentId, to: agent.id, kind: 'spawn', text: e.prompt, at: now })
      } else if (result.deny !== undefined && !e.workflow) {
        M.settleAgentCall(data, { toolUseId: e.tool_use_id, isStarted: false, why: result.deny, at: now })
      }
      touched($, now)
    } catch {
      // the spawn stands whatever the deck makes of it
    }
    return result
  })

  // the person's own words: a new goal, or a follow-up of the one in hand; anything else is an event
  on('prompt.submit', async ($, e, next) => {
    let kind: M.PromptKind = 'event'
    try {
      kind = M.promptKindOf(data, e)
    } catch {
      kind = 'event'
    }
    const result = await next(e)
    try {
      const now = await $.clock.now()
      let isChanged = false
      if (result.drop === undefined) {
        // the turn it starts logs it as yours only when it is in your words: an agent's hand-back or a notification is not
        isNextTurnTheirs = M.isUsersWords(e.origin)
        const said = expansion !== null && now - expansion.at < 10_000 ? expansion.headline : ''
        expansion = null
        if (kind !== 'event') isChanged = M.noteGoal(data, kind, { text: e.text, origin: e.origin.kind, at: now, ...(kind === 'goal' && said ? { headline: said } : {}) }) !== undefined
        // a background task's notification may end a Workflow run
        if (e.origin.kind === 'task-notification') isChanged = M.endWorkflows(data, e.text, now) || isChanged
      }
      if (isChanged) touched($, now)
    } catch {
      // the prompt goes in whatever the deck makes of it
    }
    return result
  })

  // a slash command's own words make a better headline than the prompt it expands to
  on('classic.UserPromptExpansion', async ($, e, next) => {
    try {
      const now = await $.clock.now()
      const args = F.oneLine(e.command_args)
      const headline = `/${e.command_name}${args ? ` ${args}` : ''}`
      const goal = M.goalOf(data)
      const expanded = F.oneLine(e.prompt).slice(0, 60)
      const isThisGoal = goal !== undefined && now - goal.at < 5_000 && (goal.text.trim().startsWith(`/${e.command_name}`) || (expanded !== '' && F.oneLine(goal.text).includes(expanded)))
      if (isThisGoal) {
        if (M.retitleGoal(data, headline, goal.at)) touched($, now)
      } else {
        expansion = { headline, at: now }
      }
    } catch {
      // the prompt keeps its own first line
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    try {
      const now = await $.clock.now()
      const main = M.agentOf(data, M.MAIN)
      // you answered, or the Orchestrator went on by itself: it waits on nobody
      M.clearNeeds(data, { kind: 'turn' })
      if (main) {
        main.status = 'running'
        main.lastAt = now
      }
      // a turn whose prompt came from elsewhere (an agent's hand-back, already its result) is no prompt of yours, nor one that
      // opens with a notice: a background agent's <task-notification> can start a turn with no prompt.submit before it
      const isTheirs = (isNextTurnTheirs ?? true) && !M.isNoticeText(e.text)
      isNextTurnTheirs = null
      if (e.text.trim() && isTheirs) M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: e.text, at: now })
      touched($, now)
    } catch {
      // a turn starts whatever the deck makes of it
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      const usageOfStep = result.usage
      const agent = M.agentOf(data, e.agentId ?? M.MAIN)
      if (usageOfStep && agent) {
        const now = await $.clock.now()
        agent.tokensIn += usageOfStep.input_tokens + usageOfStep.cache_creation_input_tokens
        agent.cacheRead += usageOfStep.cache_read_input_tokens
        agent.tokensOut += usageOfStep.output_tokens
        agent.requests += 1
        agent.lastAt = now
        if (!agent.model) agent.model = usageOfStep.model
        // a step of an ended agent's loop (a message woke it), or of an idle teammate's, is a new run
        if (agent.kind !== 'main' && (M.isEnded(agent.status) || agent.status === 'idle')) M.reopen(agent)
        M.bump(data, now, 'tokens', usageOfStep.input_tokens + usageOfStep.output_tokens + usageOfStep.cache_creation_input_tokens + usageOfStep.cache_read_input_tokens)
        touched($, now)
      }
    } catch {
      // counting tokens never changes the response
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      const now = await $.clock.now()
      if (e.agentId) {
        const agent = M.agentOf(data, e.agentId)
        if (agent) {
          agent.status = e.reason === 'aborted' ? 'killed' : e.reason === 'answer' ? (agent.kind === 'teammate' ? 'idle' : 'completed') : 'failed'
          agent.endedAt = now
          delete agent.current
          delete agent.todo
          // its answer is its result unless it handed a report back (whose turn answers "")
          if (e.answer.trim()) M.noteResult(data, agent, e.answer, now, 'answer')
        }
      } else {
        const main = M.agentOf(data, M.MAIN)
        if (main) {
          main.status = 'idle'
          delete main.current
          main.lastAt = now
          delete main.todo
          // its answer to you is its latest report: the web deck's Orchestrator shows it
          M.noteMainAnswer(main, e.answer)
        }
        data.turns += 1
        data.turnMs += e.durationMs
        timers.day?.cancel()
        timers.day = $.clock.after(400, () => void recordDay($))
      }
      scheduleGit($, 300)
      if (chat && chat.agent === (e.agentId ?? M.MAIN)) void loadChat($, chat.agent)
      touched($, now)
    } catch {
      // the turn's end stands whatever the deck makes of it
    }
    return result
  })

  // a subagent starting again (one the deck saw end) runs; one it never saw spawn waits for its first call
  on('classic.SubagentStart', async ($, e, next) => {
    try {
      const agent = M.agentOf(data, e.agent_id)
      if (agent && M.reopen(agent)) touched($, await $.clock.now())
    } catch {
      // the start stands whatever the deck makes of it
    }
    return next(e)
  })

  // a subagent stopped: its row ends at once, and with no report handed back its last message is its result
  on('classic.SubagentStop', async ($, e, next) => {
    const result = await next(e)
    try {
      // a stop a hook blocked goes on working
      if (result.block === undefined) {
        const now = await $.clock.now()
        if (M.noteStop(data, e.agent_id, e.last_assistant_message ?? '', now)) touched($, now)
      }
    } catch {
      // the stop stands whatever the deck makes of it
    }
    return result
  })

  // a teammate between turns: its row ends at once
  on('classic.TeammateIdle', async ($, e, next) => {
    const result = await next(e)
    try {
      if (result.block === undefined) {
        const now = await $.clock.now()
        if (M.noteIdle(data, { ...(e.agent_id ? { id: e.agent_id } : {}), name: e.teammate_name }, now)) touched($, now)
      }
    } catch {
      // the teammate idles whatever the deck makes of it
    }
    return result
  })

  // the task board, as the team's own events tell it
  on('classic.TaskCreated', async ($, e, next) => {
    const result = await next(e)
    try {
      if (result.block === undefined) {
        const now = await $.clock.now()
        const by = e.teammate_name ? M.resolveRecipient(data, e.teammate_name)?.id : e.agent_id
        const task = { id: e.task_id, subject: e.task_subject, ...(e.task_description ? { description: e.task_description } : {}), ...(by ? { by } : {}) }
        if (M.noteTaskEvent(data, 'created', task, now)) touched($, now)
      }
    } catch {
      // the task stands whatever the deck makes of it
    }
    return result
  })

  on('classic.TaskCompleted', async ($, e, next) => {
    const result = await next(e)
    try {
      if (result.block === undefined) {
        const now = await $.clock.now()
        const by = e.teammate_name ? M.resolveRecipient(data, e.teammate_name)?.id : e.agent_id
        const task = { id: e.task_id, subject: e.task_subject, ...(e.task_description ? { description: e.task_description } : {}), ...(by ? { by } : {}) }
        if (M.noteTaskEvent(data, 'completed', task, now)) touched($, now)
      }
    } catch {
      // the task stands whatever the deck makes of it
    }
    return result
  })

  on('session.send', async ($, e, next) => {
    const result = await next(e)
    try {
      const isMine = e.origin.kind === 'plugin' && e.origin.name === $.plugin.name
      if (!isMine) {
        const now = await $.clock.now()
        const from = e.agentId ?? M.MAIN
        if (from !== M.MAIN) M.seeLoop(data, from, now)
        // a name two agents carried goes to the newest live one
        const target = M.resolveRecipient(data, e.to) ?? M.peerOf(data, e.to, now)
        M.addMessage(data, { from, to: target.id, kind: 'message', text: e.text, at: now, isDelivered: result.isDelivered })
        touched($, now)
      }
    } catch {
      // the message goes whatever the deck makes of it
    }
    return result
  })

  on('session.receive', async ($, e, next) => {
    const result = await next(e)
    try {
      const origin = e.origin
      const now = await $.clock.now()
      if (origin.kind === 'task-notification' && M.endWorkflows(data, e.text, now)) touched($, now)
      if (origin.kind === 'peer' || origin.kind === 'coordinator' || origin.kind === 'peer-send-message') {
        const to = e.agentId ?? M.MAIN
        // the receiver reads a send inside an envelope (<agent-message from="…">): matched without it, logged once
        const echo = M.echoOf(data, to, e.text, now)
        if (echo) {
          echo.isDelivered = true
          if (echo.to !== to && M.agentOf(data, to)) echo.to = to
        } else if (!('plugin' in origin && origin.plugin === $.plugin.name)) {
          const unwrapped = M.unwrapMessage(e.text)
          const named = 'teammate' in origin ? origin.teammate : unwrapped.from
          const from = named
            ? (M.resolveRecipient(data, named)?.id ?? M.peerOf(data, named, now).id)
            : origin.kind === 'coordinator'
              ? M.MAIN
              : M.peerOf(data, origin.kind === 'peer-send-message' ? 'another session' : 'peer', now).id
          if (unwrapped.text.trim() !== '') M.addMessage(data, { from, to, kind: 'message', text: unwrapped.text, at: now })
        }
        touched($, now)
      }
    } catch {
      // the delivery stands whatever the deck makes of it
    }
    return result
  })

  // Waiting on you: a permission prompt, an MCP server's question, Claude idle for your input. Observe only.
  on('classic.Notification', async ($, e, next) => {
    try {
      if (M.isNeedsYou(e.notification_type, e.message)) {
        const now = await $.clock.now()
        M.noteNeeds(data, { kind: e.notification_type, text: e.message, at: now, ...(e.agent_id ? { agent: e.agent_id } : {}) })
        touched($, now)
      }
    } catch {
      // the notification goes out whatever the deck makes of it
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    isPaneOpen = true
    const now = await $.clock.now()
    shownKey = screenKey(now)
    const kit = kitOf($.ui.resolve(e), e.surface, Math.max(24, e.props.bodyColumns - 1))
    return deckView(kit, modelOf(now), actionsFor($))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // a workflow's agents and the engine's own loops fold away: they raise no band
    const isLive = M.hasLiveAgents(data)
    if (view.isBandHidden || e.props.hasSurvey || !isLive) return next(e)
    const theirs: RenderElement = await next(e)
    const now = await $.clock.now()
    // the band speaks for the screen only while the pane, which shows more, is shut
    if (!isPaneOpen) shownKey = screenKey(now)
    const kit = kitOf($.ui.resolve(e), e.surface, Math.max(24, e.props.bodyColumns))
    return bandView(kit, modelOf(now), actionsFor($), theirs) ?? theirs
  })

  on('ui.render', { component: 'Pane', requestId: PROBE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    // a table answers to every element name (a missing one draws a fragment): the surface says which really draw
    const Client = (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in ui ? ui.Client : undefined
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined
    return probeView(ui, e, Client, Svg)
  })

  // what the probe's Client posts (a click's cell); only this plugin's hooks hear it
  on('ui.message', { component: 'Pane', requestId: PROBE }, async ($, e, next) => {
    probe.message = jsonLine(e.data)
    redraw($)
    return next(e)
  })

  // the probe's Client failed: say when and why, and leave it out of that surface's drawing
  on('ui.fault', { component: 'Pane', requestId: PROBE }, async ($, e, next) => {
    probe.fault = { surface: e.surface, phase: e.phase, reason: F.oneLine(e.reason) }
    probe.failedOn.add(e.surface)
    redraw($)
    return next(e)
  })
}
