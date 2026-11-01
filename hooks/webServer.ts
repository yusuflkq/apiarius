/**
 * The web deck's live half: Apiarius's home on disk (kept private by
 * web/home.js), the `web/server.js` child it starts and watches for the
 * session (`superviseWeb`), the state folder it writes (`writeWeb`), the
 * tickets its links carry, the openers (your own browser through
 * web/open.js, Claude's Browser pane), and what the Browser pane's page
 * sends in your voice, held for your Send above the prompt (./hold).
 *
 * Its state is its own (`web`, `held`, the home), read by the hooks module
 * (register.tsx) through the accessors below; what it reads of that module's
 * (the session's data, view and usage, the v2 view model) and asks of it (a
 * redraw, an ack, a page command run) it imports from there, and git's state
 * from ./gitRunner. What is pure is ./web's.
 */
import type { CommandRunResult, EngineInterface, Timer } from 'claude-code'

import * as F from './format'
import { currentGit, currentGitDiffs, readGitDiffs } from './gitRunner'
import * as H from './hold'
import * as M from './model'
import {
  ack,
  answerGoneOf,
  currentAskers,
  currentCwd,
  currentData,
  currentSessionId,
  currentUsage,
  currentView,
  redraw,
  runCommand,
  v2Of,
} from './register'
import * as SR from './registry'
import * as SE from './sessions'
import * as T from './timeline'
import type { WebPane } from './ui/types'
import * as W from './web'

/** The mod's folder (`$.plugin.root`, no trailing separator). */
let pluginRoot = ''
/** Apiarius's home (`SE.homeDirOf`: `APIARIUS_HOME`, else `apiarius` under Claude Code's configuration folder), where each session's state folder lies (`<home>/web/<sessionId>`) and the debug dump goes; '' until read, or when no home is known. */
let home = ''

/** Where the deck starts a `node` child: the mod's own folder, else the home, never a workspace, so Windows (which looks for a bare `node` in the working folder first) never runs one a repository holds; undefined when neither is known (the session's own folder then, as in the tests). */
export function nodeCwd(): string | undefined {
  return pluginRoot || home || undefined
}

/** The web deck's timer: its next write of the state folder (`scheduleWeb`). */
const timers: { web?: Timer } = {}

/**
 * The web deck. `/apiarius web`, or "Open in browser" (the deck's header,
 * `o`, Settings), starts `web/server.js` for the session and opens the page
 * in your own browser with the system's opener; `/apiarius web pane` opens
 * it in the Desktop's Browser pane instead. Each link carries a one-time
 * ticket the page trades for a handle (web/server.js), of one of two grades
 * (`W.WebGrade`): your own browser's is `full`; the Browser pane's is
 * `pane`, since Claude's tools drive that pane, and what it sends in your
 * voice waits for your Send in the band (./hold). The terminal deck shows a `full` one as text
 * to copy. A link is never in what the model reads. While it is on, what the
 * deck holds goes to `<home>/web/<sessionId>/state.json` at most every 300 ms
 * after a change (`W.webStateOf`, with the v2 view model under `v2`), each
 * edit's patch once beside it, each agent's file when it changed, and the
 * page's commands come back as lines on the server's stdout.
 *
 * The folder is private (0700, each file 0600 before its first write, by
 * web/home.js) and lives only as long as the session: removed at its end,
 * emptied at a /clear, and a crashed session's swept at the next start.
 *
 * The child is the session's: `superviseWeb` runs from session.start, whose
 * `$` outlives every hook, and spawns it each time it is asked. Leaving its
 * loop (`/apiarius web stop`) or a reload of this module kills it, and its
 * `--parent` check ends it with the session's process (its stdin carries
 * the secret and then closes, so stdin cannot tell it). Every start makes a
 * new secret, never kept: a reload starts it again on the port `$.state`
 * kept, and a page open on it hears its old handle refused and says to open
 * it again from the deck.
 */
const WEB_STATE = { plugin: 'apiarius', key: 'web' } as const
/** How long a start waits for the server's ready line. */
const WEB_START_MS = 10_000

/** Whether the home is Apiarius's own (no `APIARIUS_HOME`): then it is made 0700 too; a folder the person named stays as they keep it. */
let isHomeOwn = false
/** The registry folder as the environment names it (`SE.registryDirOf`), for the start's sweep: read with the home. */
let homeRegistry = ''

/** Apiarius's home (`home`), read from the environment once: '' when no home is known, and then nothing is kept on disk. */
export async function homeOf($: EngineInterface): Promise<string> {
  if (home !== '') return home
  const read = async (get: () => Promise<string | undefined>) => {
    try {
      return await get()
    } catch {
      return undefined
    }
  }
  const env = {
    override: await read(() => $.env.get('APIARIUS_SESSIONS')),
    apiariusHome: await read(() => $.env.get('APIARIUS_HOME')),
    configDir: await read(() => $.env.get('CLAUDE_CONFIG_DIR')),
    home: (await read(() => $.env.get('USERPROFILE'))) ?? (await read(() => $.env.get('HOME'))),
  }
  home = SE.homeDirOf(env)
  homeRegistry = SE.registryDirOf(env)
  isHomeOwn = !(env.apiariusHome && env.apiariusHome.trim() !== '')
  return home
}

/** Asks web/home.js (node, no shell) to keep the home private, or to remove what the session no longer needs; whether it did. */
export async function runHome($: EngineInterface, request: W.HomeRequest): Promise<boolean> {
  if (request.home === '') return false
  try {
    const ran = await $.process.run(W.homeArgvOf(`${$.plugin.root.replace(/[\\/]+$/, '')}/web/home.js`, request), { timeoutMs: 10_000, ...(nodeCwd() ? { cwd: nodeCwd() } : {}) })
    return ran.exitCode === 0 && W.isHomeDone(ran.stdout)
  } catch {
    return false
  }
}

/**
 * At session.start: the folders of sessions that are gone swept (a crash
 * leaves its own), then this session's own made private, with its inbox,
 * before any deck writes there.
 */
export async function startHome($: EngineInterface): Promise<void> {
  if (home === '' || currentSessionId() === '') return
  await runHome($, { op: 'sweep', home, registry: homeRegistry, keep: currentSessionId() })
  // the registry folder named too, so it and this session's file in it are made private (0700/0600) however the race with the registry writer goes
  if (await runHome($, { op: 'prepare', home, id: currentSessionId(), files: [], isOwnHome: isHomeOwn, ...(homeRegistry !== '' ? { registry: homeRegistry } : {}) })) web.isPrivate = true
}

const web: {
  /** On for this session, from the first /apiarius web until /apiarius web stop, as `$.state` keeps it. */
  isOn: boolean
  /** The secret the running server seals its tickets with (`W.ticketOf`): new for every start, never kept; '' while none runs. */
  secret: string
  /** The `full` ticket the terminal deck shows as its link, made when the server is ready and again once the page it opened traded it; '' before. */
  shown: string
  /** The port the server listens on, taken again after a reload; 0 before it is known. */
  port: number
  /** The port a restart asked for again, until its ready line says which it got. */
  keptPort: number
  /** The folder it serves (`<home>/web/<sessionId>`), fixed for the server's life. */
  dir: string
  /** The folder was made private (0700, by web/home.js) in this module's life: nothing is written in it before. */
  isPrivate: boolean
  /** The files in it made 0600 before their first write, by their place under the home. */
  made: Set<string>
  /** The session ended: its folder is gone, and nothing is written again. */
  isEnded: boolean
  /** Moves when the folder is emptied or removed: a write begun before writes no more of what it had. */
  gen: number
  /** The write under way, which an emptying or a removal waits for. */
  writing: Promise<void>
  status: WebPane['status']
  /** Why it is not running, as the pane and `/apiarius web` say it; '' while it runs. */
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
  /** Git's diffs written (gitdiffs/<id>.diff), by their id. */
  gitDiffsWritten: Set<string>
  /** The state last written, its time left out. */
  lastKey: string
  /** Each agent's file (`agents/<id>.json`) as last written, by its web id: one is written again only when it changed. */
  agentFiles: Map<string, string>
  isWriting: boolean
  isWriteQueued: boolean
} = {
  isOn: false,
  secret: '',
  shown: '',
  port: 0,
  keptPort: 0,
  dir: '',
  isPrivate: false,
  made: new Set(),
  isEnded: false,
  gen: 0,
  writing: Promise.resolve(),
  status: 'off',
  note: '',
  opened: '',
  pid: '',
  epoch: 0,
  isAsked: false,
  waiters: [],
  written: new Set(),
  gitDiffsWritten: new Set(),
  lastKey: '',
  agentFiles: new Map(),
  isWriting: false,
  isWriteQueued: false,
}

/** Whether the web deck is on for this session (`web.isOn`). */
export function isWebOn(): boolean {
  return web.isOn
}

/** The folder the web deck serves (`web.dir`); '' until one is fixed. */
export function webDir(): string {
  return web.dir
}

/** Apiarius's home as read (`home`); '' before it is, or when no home is known. */
export function homeDir(): string {
  return home
}

/** Whether the home is Apiarius's own (`isHomeOwn`). */
export function isOwnHome(): boolean {
  return isHomeOwn
}

/** Sets the mod's folder (`pluginRoot`), as session.start reads it. */
export function setPluginRoot(root: string): void {
  pluginRoot = root
}

/** What the Browser pane's page sent in your voice, waiting for your Send above the prompt (`held`). */
export function heldQueue(): Readonly<typeof held> {
  return held
}

/** The web deck as the debug dump tells it: its switch, server and folder, and what waits for your Send. */
export function webDebugOf() {
  return { isOn: web.isOn, status: web.status, port: web.port, dir: web.dir, opened: web.opened, note: web.note, patches: web.written.size, hasParent: web.pid !== '', held: held.items.map(item => ({ kind: item.kind, to: item.to, session: item.session, at: item.at })) }
}

/** The session's process id (`enginePidOf`), read once and kept for the server's `--parent`; '' when it could not be read. */
export async function sessionPidOf($: EngineInterface): Promise<string> {
  if (web.pid === '') web.pid = await enginePidOf($)
  return web.pid
}

/** A deck began to view this session (./registry): its folder written from now, as for /apiarius web. */
export function shareWeb($: EngineInterface): void {
  if (web.dir === '' && currentSessionId() !== '') web.dir = W.webDirOf(home, currentSessionId())
  web.lastKey = ''
  web.agentFiles.clear()
  void readGitDiffs($)
  scheduleWeb($)
}

/** The web deck's supervisor, a session.start's (`superviseWeb`): the one before it stops, and the deck is on again at once when a reload found it on. */
export function startSupervisor($: EngineInterface): void {
  web.epoch += 1
  const wake = web.wake
  web.wake = undefined
  wake?.()
  web.stop?.()
  void superviseWeb($, web.epoch)
}

/** The web deck as the pane draws it: its link the `full` one the terminal shows (`web.shown`). */
export function webPaneOf(): WebPane {
  const isUp = web.status === 'running' && web.port > 0 && web.shown !== ''
  return { status: web.status, url: isUp ? W.webUrlOf(web.port, web.shown) : '', opened: web.opened, note: web.note }
}

/** A new one-time ticket of `grade` for the running server ('' while none runs): each link the deck hands out carries its own; with `until` (seconds since the epoch) it works until then only. */
function ticketFor(grade: W.WebGrade, until = 0): string {
  return web.secret === '' ? '' : W.ticketOf(web.secret, grade, W.newNonce(), until)
}

/** Keeps the web deck's switch, port and folder in `$.state`, so a reload starts it again where it was; its secret never. */
function saveWeb($: EngineInterface) {
  void $.state.set(WEB_STATE, { isOn: web.isOn, port: web.port, dir: web.dir }).catch(() => undefined)
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

/** Whether the state folder is written: while the web deck is on, or another session's deck views this one (./registry); never once the session ended. */
export function isSharing(): boolean {
  return !web.isEnded && (web.isOn || SR.isShared())
}

/** The data changed: the web deck's state is written within 300 ms while it is on (or this session is viewed); changes meanwhile ride along. */
export function scheduleWeb($: EngineInterface) {
  if (!isSharing() || web.dir === '' || timers.web) return
  timers.web = $.clock.after(W.WEB_WRITE_MS, () => {
    timers.web = undefined
    void writeWeb($)
  })
}

/**
 * Makes the folder private (0700) and each of `files` (by its name in the
 * folder) 0600 before its first write, in one call of web/home.js: the
 * engine's write keeps an existing file's mode. Those made already are not
 * asked again. False when it could not: then nothing is written.
 */
async function makePrivate($: EngineInterface, files: readonly string[]): Promise<boolean> {
  const id = W.idOfWebDir(home, web.dir)
  if (id === '') return false
  const fresh = files.map(file => W.homeFileOf(id, file)).filter(file => file !== '' && !web.made.has(file))
  if (web.isPrivate && fresh.length === 0) return true
  if (!(await runHome($, { op: 'prepare', home, id, files: fresh, isOwnHome: isHomeOwn }))) return false
  web.isPrivate = true
  for (const file of fresh) web.made.add(file)
  return true
}

/**
 * Writes what the page reads: each edit's patch not written yet
 * (`patches/<id>.diff`, once), each cut message's whole text not written yet
 * (`messages/<id>.md`, once: it is then marked saved and its whole text let
 * go), each agent's file that changed (`agents/<id>.json`, v2's), git's
 * diff of each uncommitted file not written yet (`gitdiffs/<id>.diff`,
 * once), then `state.json` (v1, and the v2 view model the pane draws under `v2`),
 * unless it says what the last write said (its time aside). Each file new
 * to the folder is made 0600 first (`makePrivate`); nothing is written while
 * that fails. One write at a time: a change during one writes again after it.
 */
async function writeWeb($: EngineInterface): Promise<void> {
  if (!isSharing() || web.dir === '') return
  if (web.isWriting) {
    web.isWriteQueued = true
    return
  }
  web.isWriting = true
  let done = () => {}
  web.writing = new Promise<void>(resolve => {
    done = resolve
  })
  const gen = web.gen
  // each file written only while the folder is still this write's: an emptying or a removal since stops it (the catch below)
  const put = async (path: string, text: string) => {
    if (gen !== web.gen || !isSharing()) throw new Error('the folder was emptied or removed')
    await $.fs.write(path, text)
  }
  try {
    const patches = W.newPatchesOf(currentData(), web.written)
    const messages = W.newMessageFilesOf(currentData())
    const agents = W.agentFilesOf(currentData()).filter(file => web.agentFiles.get(file.id) !== file.text)
    const diffs = W.newGitDiffsOf(currentGitDiffs(), web.gitDiffsWritten)
    const names = [
      'state.json',
      'timeline.json',
      ...patches.map(patch => `patches/${patch.id}.diff`),
      ...messages.map(file => `messages/${file.id}.md`),
      ...agents.map(file => `agents/${file.id}.json`),
      ...diffs.map(diff => `gitdiffs/${diff.id}.diff`),
    ]
    if (!(await makePrivate($, names))) return
    for (const patch of patches) {
      await put(`${web.dir}/patches/${patch.id}.diff`, patch.text)
      web.written.add(patch.id)
    }
    for (const file of messages) {
      await put(`${web.dir}/messages/${file.id}.md`, file.text)
      file.message.isSaved = true
      delete file.message.full
    }
    for (const file of agents) {
      await put(`${web.dir}/agents/${file.id}.json`, file.text)
      web.agentFiles.set(file.id, file.text)
    }
    for (const diff of diffs) {
      await put(`${web.dir}/gitdiffs/${diff.id}.diff`, diff.text)
      web.gitDiffsWritten.add(diff.id)
    }
    const now = await $.clock.now()
    // Org's Timeline (timeline.json), before the state: written again when it says something new, its time aside
    const timeline = T.timelineTextOf(T.timelineOf(currentData(), v2Of(now)))
    const timelineKey = timeline.replace(/^\{"v":2,"now":\d+,/, '')
    if (timelineKey !== timelineWritten.key) {
      await put(`${web.dir}/timeline.json`, timeline)
      timelineWritten.key = timelineKey
    }
    // a question the page may answer is one whose race runs in this module: none after a reload
    const text = JSON.stringify({ ...W.webStateOf(currentData(), currentView(), currentGit(), currentUsage(), now, currentSessionId(), currentCwd(), new Set(currentAskers().keys())), v2: v2Of(now) })
    // both builds' times left out: a state that says nothing new is not written again
    const key = text.replace(/^\{"v":1,"now":\d+,/, '').replace(/,"v2":\{"v":2,"now":\d+,/, ',"v2":{')
    if (key !== web.lastKey) {
      await put(`${web.dir}/state.json`, text)
      web.lastKey = key
    }
  } catch {
    // a write that failed waits for the next change
  } finally {
    web.isWriting = false
    done()
    if (web.isWriteQueued) {
      web.isWriteQueued = false
      scheduleWeb($)
    }
  }
}

/** Org's Timeline as timeline.json was last written, its time left out: it is written again only when it changed. */
const timelineWritten = { key: '' }

/** The session's own process id, read as the parent of a node it starts (no shell between); '' when node cannot say. */
async function enginePidOf($: EngineInterface): Promise<string> {
  try {
    const ran = await $.process.run(['node', '-p', 'process.ppid'], { timeoutMs: 10_000, ...(nodeCwd() ? { cwd: nodeCwd() } : {}) })
    const pid = ran.stdout.trim()
    return ran.exitCode === 0 && /^\d+$/.test(pid) ? pid : ''
  } catch {
    return ''
  }
}

/**
 * The session's web deck, for as long as this session.start is the latest:
 * picks up what `$.state` kept (a reload while it was on asks for the server
 * again, on its port), then runs the server each time it is asked.
 * A folder kept that is no longer this session's (one a /clear's old id
 * named) is let go, and removed when it is in the home: the server serves
 * this session's own.
 */
async function superviseWeb($: EngineInterface, epoch: number): Promise<void> {
  try {
    const { value } = await $.state.get(WEB_STATE)
    if (value && value.isOn === true && epoch === web.epoch) {
      web.isOn = true
      web.port = typeof value.port === 'number' && value.port > 0 ? value.port : 0
      const own = W.webDirOf(await homeOf($), currentSessionId())
      if (typeof value.dir === 'string' && value.dir !== '' && value.dir !== own) {
        const old = W.idOfWebDir(home, value.dir)
        if (old !== '' && old !== currentSessionId()) void runHome($, { op: 'remove', home, ids: [old] })
      }
      if (own !== '') web.dir = own
      web.status = 'starting'
      web.isAsked = true
    }
  } catch {
    // nothing kept: the web deck waits for /apiarius web
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
 * web/server.js` starts with a new secret on its stdin. A restart on a
 * kept port that never comes up is tried once more on a port the OS picks.
 */
async function runWeb($: EngineInterface, epoch: number): Promise<void> {
  const root = $.plugin.root.replace(/[\\/]+$/, '')
  const script = `${root}/web/server.js`
  web.status = 'starting'
  web.note = ''
  if (web.dir === '') web.dir = W.webDirOf(await homeOf($), currentSessionId())
  // no home to keep its state in, or none that could be made private: the deck stays native
  if (web.dir === '' || !(await makePrivate($, []))) {
    web.isOn = false
    web.status = 'failed'
    web.note = web.dir === '' ? 'No home folder is known (HOME), so the dashboard has nowhere to keep its state.' : 'Its state folder could not be made private, so the dashboard does not start.'
    saveWeb($)
    settleWeb(false)
    redraw($)
    return
  }
  saveWeb($)
  redraw($)
  web.lastKey = ''
  web.agentFiles.clear()
  timelineWritten.key = ''
  void readGitDiffs($)
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
  let ran = await spawnWeb($, W.serverArgvOf(script, web.dir, web.pid, web.port, SR.registryDir()))
  if (!ran.isReady && !ran.isMissing && web.port > 0 && web.isOn && epoch === web.epoch) {
    web.port = 0
    ran = await spawnWeb($, W.serverArgvOf(script, web.dir, web.pid, 0, SR.registryDir()))
  }
  web.keptPort = 0
  if (epoch !== web.epoch) return
  // what the server handed out ended with it
  web.secret = ''
  web.shown = ''
  if (!web.isOn) {
    web.status = 'off'
  } else if (ran.isMissing) {
    // no node: the deck stays native
    web.isOn = false
    web.status = 'failed'
    web.note = 'Node.js was not found on PATH, so the dashboard cannot start.'
    saveWeb($)
    $.ui.toast('Apiarius web needs Node.js on PATH; the deck stays in its pane.')
  } else {
    web.status = 'failed'
    web.note = ran.isReady
      ? `The dashboard's server stopped${ran.why ? ` (${ran.why})` : ''}; Open in browser starts it again.`
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
 * One run of the server, with a secret of its own (every start's is new,
 * so no ticket or handle of an earlier one works on it): its stdout read
 * line by line as it comes (a chunk may cut a line or hold several;
 * `W.splitLines` holds the rest), its stderr kept for why it ended, until
 * the child ends or `web.stop` ends the loop. Rejects never: a start that
 * fails (no node) is a run that says so.
 */
async function spawnWeb($: EngineInterface, argv: readonly string[]): Promise<WebRun> {
  let rest = ''
  let isReady = false
  let errors = ''
  let stop: (() => void) | undefined
  web.secret = W.newSecret()
  web.shown = ''
  try {
    // the secret on stdin, never argv or the environment, which other processes can read; started outside any workspace (Windows looks for a bare `node` in the working folder first)
    const child = $.process.spawn({ argv, input: `${web.secret}\n`, ...(nodeCwd() ? { cwd: nodeCwd() } : {}) })
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
 * A whole line from the server: its ready line (the port it listens on); a
 * ticket traded (the terminal's link, once used, is made anew); or a command
 * from the page, checked against the model (`W.routeOf`) and acted on:
 * `chat` through `sendChat`, `review` through `sendReview`, `answer` to the
 * question it names (`answerCall`, the pane's resolver too). One in your
 * voice from a `pane` page, and every one of its for another session's
 * deck but `view` (`H.isHeld`), waits for your Send above the prompt
 * instead (`holdFromPage`). A command with an `id` gets an ack, the page's word on
 * what came of it; one refused gets why. Anything else is ignored. Answers
 * whether it was the ready line.
 */
function onWebLine($: EngineInterface, line: string): boolean {
  const said = W.parseLine(line)
  if (said === null) return false
  if (said.kind === 'used') {
    if (said.nonce === W.nonceOf(web.shown)) {
      web.shown = ticketFor('full')
      redraw($)
    }
    return false
  }
  if (said.kind === 'ready') {
    const kept = web.keptPort
    web.keptPort = 0
    web.port = said.port
    web.status = 'running'
    web.note = ''
    web.shown = ticketFor('full')
    saveWeb($)
    settleWeb(true)
    // the page open before a reload knows the old port only
    if (kept > 0 && kept !== said.port) $.ui.toast('Apiarius web started again on another port: /apiarius web opens it again, and /apiarius shows its new link.')
    redraw($)
    return true
  }
  // in your voice from the Browser pane's page, or any press of it for another session's deck: it waits for your Send above the prompt
  if (said.grade !== 'full' && H.isHeld(said.cmd, currentSessionId())) {
    void holdFromPage($, said.cmd)
    return false
  }
  runFromPage($, said.cmd)
  return false
}

/** A page's command run: one for another session's deck (the page views it) into its inbox, where its own deck takes it; this session's through `runCommand`. */
function runFromPage($: EngineInterface, cmd: Record<string, unknown>): void {
  const other = SE.sessionCmdOf(cmd, currentSessionId())
  if (other) void SR.fromPage(other.session, other.cmd)
  else runCommand($, cmd)
}

/**
 * What the Browser pane's page sent in your voice, waiting for your Send in
 * the band above the prompt (./hold), oldest first; the rows opened to their
 * whole text; a count that moves with every change, for the band's drawing;
 * and the next key.
 */
const held: { items: H.Held[]; open: Set<string>; version: number; seq: number } = { items: [], open: new Set(), version: 0, seq: 0 }

/** Whom a command for this session goes to, in words: its agent's name ("Orchestrator", "builder"), the Orchestrator for Review, an answer's asker. */
function heldToOf(cmd: Record<string, unknown>): string {
  if (cmd.cmd === 'review') return ''
  const route = W.routeOf(cmd, currentData())
  const id = route?.kind === 'chat' ? route.agentId : route?.kind === 'answer' ? (M.pendingOf(currentData()).find(one => one.id === route.callId)?.agentId ?? M.MAIN) : M.MAIN
  const agent = M.agentOf(currentData(), id)
  return agent ? M.labelOf(agent) : M.ORCHESTRATOR
}

/**
 * A command in your voice from the Browser pane's page, or any press of it
 * for another session's deck (a Stop there too): checked as it would be
 * once sent (one refused now is refused at once, never held), then held in
 * the band for your Send, its ack saying so; refused while `H.MOST_HELD`
 * wait already. One for another session's deck goes into its inbox once
 * you press Send.
 */
async function holdFromPage($: EngineInterface, cmd: Record<string, unknown>): Promise<void> {
  const ackId = W.cmdIdOf(cmd)
  const other = SE.sessionCmdOf(cmd, currentSessionId())
  // one that names another session it cannot go to is never run as this one's
  const isElsewhere = !other && typeof cmd.session === 'string' && cmd.session !== '' && cmd.session !== currentSessionId()
  const route = other || isElsewhere ? null : W.routeOf(cmd, currentData())
  // an answer to a question that no longer waits here is refused at once, as it would be once sent
  const gone = route?.kind === 'answer' ? answerGoneOf(route.callId) : ''
  const refusal = isElsewhere ? SE.steeringRefusalOf(cmd) : other ? (SE.steeringCmdOf(other.cmd) ? '' : SE.steeringRefusalOf(other.cmd)) : route === null ? W.refusalOf(cmd, currentData()) : gone
  if (refusal !== '' || held.items.length >= H.MOST_HELD) {
    void ack($, ackId, 'failed', refusal || H.FULL_TEXT)
    return
  }
  const now = await $.clock.now()
  const agentOfOther = other && (other.cmd.cmd === 'chat' || other.cmd.cmd === 'stopAgent') && other.cmd.agentId !== M.MAIN ? ` · ${F.trunc(F.oneLine(String(other.cmd.agentId)), 40)}` : ''
  const to = other ? `${SR.sessionNameOf(other.session)}${agentOfOther}` : heldToOf(cmd)
  held.seq += 1
  held.items.push(H.heldOf(other ? other.cmd : cmd, `h${held.seq}`, now, other?.session ?? '', to))
  held.version += 1
  await ack($, ackId, 'held', H.HELD_TEXT)
  $.ui.toast('From the web page: it waits above your prompt for your Send.')
  // it goes unsent once its ten minutes are up (the tick looks too)
  $.clock.after(H.HOLD_MS, () => void pruneHeld($))
  redraw($)
}

/** Takes held command `key` out of the queue; undefined when it went already. */
function takeHeld(key: string): H.Held | undefined {
  const at = held.items.findIndex(item => item.key === key)
  if (at < 0) return undefined
  const [item] = held.items.splice(at, 1)
  held.open.delete(key)
  held.version += 1
  return item
}

/**
 * Your Send on a held row: the command runs exactly as a page in your own
 * browser would have run it at once (its checks again, its ack under the
 * page's id); one for another session's deck goes into its inbox, sealed,
 * as ever. A long or many-line one goes only while its row is open (More).
 */
export function sendHeld($: EngineInterface, key: string): void {
  // a long or many-line one goes only once it is open, its whole text on screen (the band draws its Send only then)
  const shown = H.heldRowsOf(held.items.filter(one => one.key === key), held.open)[0]
  if (!shown || (shown.isLong && !shown.isOpen)) return
  const item = takeHeld(key)
  if (!item) return
  if (item.session === '') {
    runCommand($, item.cmd)
  } else {
    void SR.fromPage(item.session, item.cmd).then(why => {
      // its own deck acks it in its own state; here the word it went
      if (why === '') void ack($, item.ackId, 'queued', 'Sent to its deck')
    })
  }
  redraw($)
}

/** Your Discard on a held row: nothing is sent, and the page's ack says so. */
export function discardHeld($: EngineInterface, key: string): void {
  const item = takeHeld(key)
  if (!item) return
  void ack($, item.ackId, 'failed', H.unsentText('discarded'))
  redraw($)
}

/** More and Less on a held row too long for one line: its whole text shown, or its start again. */
export function toggleHeld($: EngineInterface, key: string): void {
  if (!held.items.some(item => item.key === key)) return
  if (!held.open.delete(key)) held.open.add(key)
  held.version += 1
  redraw($)
}

/** The held commands whose ten minutes are up go unsent, and an answer held for a question that no longer waits goes with why; the page's acks say so. */
export async function pruneHeld($: EngineInterface): Promise<void> {
  if (held.items.length === 0) return
  const now = await $.clock.now()
  const expired = new Set(H.expiredOf(held.items, now))
  let isChanged = false
  for (const item of [...held.items]) {
    const route = item.session === '' && item.kind === 'answer' && !expired.has(item) ? W.routeOf(item.cmd, currentData()) : null
    const gone = route?.kind === 'answer' ? answerGoneOf(route.callId) : ''
    if (!expired.has(item) && gone === '') continue
    takeHeld(item.key)
    isChanged = true
    void ack($, item.ackId, 'failed', gone || H.unsentText('expired'))
  }
  if (isChanged) redraw($)
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

/**
 * Opens `url` in the Desktop's Browser pane: its server's preview_start over
 * MCP (by either spelling of its name), else as a tool call; false when none
 * takes it. Neither records the call in the conversation: the model never
 * sees the URL (checked with a headless session: the call's arguments and
 * result reach the mod alone).
 */
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
 * What `/apiarius web` and `/apiarius web pane` answer once the page is up:
 * no link, since a command's text reaches the model as its output; the
 * links are the deck's.
 */
const WEB_OPENED_TEXT = 'Apiarius web is running on this machine and opened in your own browser. Open in browser, at the top of the deck (/apiarius), opens it again.'
const WEB_PANE_TEXT = "Apiarius web is open in Claude's Browser pane. What you send from there waits above your prompt until you press Send."
const WEB_NO_PANE_TEXT = 'Apiarius web is running on this machine. A terminal has no Browser pane: press o in the deck (/apiarius), or Open in browser at its top, to open it in your own browser. The deck also shows a link to copy under its header.'

/** What the model is told beside each: that the link is the person's. */
const WEB_CONTEXT = ['/apiarius web opened the Apiarius dashboard for the user. Its address is for the user alone; if they ask to see it again, tell them to run /apiarius web, which opens it itself.']

/** What a start of the web deck that ended the session refused says. */
const WEB_ENDED_TEXT = 'This session has ended: Apiarius web starts again in a new one.'

/** Why the server is not up after `ensureWeb` gave up on it, in a sentence: it never answered, or what stopped it. */
function webDownWhy(): string {
  return web.status === 'starting' ? "The dashboard's server did not answer within 10 s." : web.note || "The dashboard's server did not start."
}

/** Whether the session draws only in a terminal, where there is no Browser pane; false while that is not known. */
async function isTerminalOnly($: EngineInterface): Promise<boolean> {
  try {
    const surfaces = await $.session.surfaces()
    return surfaces.length > 0 && surfaces.every(surface => surface === 'terminal')
  } catch {
    return false
  }
}

/**
 * `/apiarius web`: the page in your own browser, as Open in browser opens it
 * (`openOwnBrowser`: started first when it is not running, a `full` link
 * made for it on web/open.js's stdin). `/apiarius web pane` (`where`
 * `pane`), which nothing in the deck offers: started if need be,
 * then the Browser pane (left to run) asked to open it with a new `pane`
 * ticket, whose words in your voice wait for your Send (./hold); in a
 * session that draws only in a terminal, which has no Browser pane, no pane
 * is asked and the deck shows its link to copy. A link acts as the person,
 * so it goes to the person alone (the system's opener, the Browser pane,
 * the terminal's link text, `webPaneOf`), never to the model: the answer's
 * text and context, which the model reads, say where it is, never a link
 * nor why an opener failed. Without node the deck stays native.
 */
export async function openWeb($: EngineInterface, where: 'own' | 'pane'): Promise<CommandRunResult> {
  if (web.isEnded) return { text: WEB_ENDED_TEXT }
  if (where === 'own') {
    const opened = await ownBrowserOpen($)
    if (opened.kind === 'down') return { text: `${opened.why} The deck stays in its pane: /apiarius.` }
    if (opened.kind === 'busy') return { text: 'Apiarius web is starting, and opens in your own browser once it is up.' }
    if (opened.kind === 'unopened') {
      const copy = (await isTerminalOnly($)) ? ' The deck also shows a link to copy under its header.' : ''
      return { text: `Apiarius web is running on this machine, but your browser did not open. Open in browser, at the top of the deck (/apiarius), tries again.${copy}`, context: WEB_CONTEXT }
    }
    return { text: WEB_OPENED_TEXT, context: WEB_CONTEXT }
  }
  const isUp = await ensureWeb($)
  if (!isUp) {
    const why = webDownWhy()
    $.ui.toast(`Apiarius web: ${why}`)
    return { text: `${why} The deck stays in its pane: /apiarius.` }
  }
  if (await isTerminalOnly($)) {
    web.opened = 'failed'
    redraw($)
    return { text: WEB_NO_PANE_TEXT, context: WEB_CONTEXT }
  }
  void showWeb($, W.webUrlOf(web.port, ticketFor('pane')))
  return { text: WEB_PANE_TEXT, context: WEB_CONTEXT }
}

/** A press of Open in browser is waiting for the server it started: another press meanwhile starts and opens nothing. */
let isBrowserWaiting = false

/**
 * How a try to open the deck in your own browser went: opened; nothing
 * done, since a try before it waits for the server it started (`busy`); the
 * server would not come up (`down`), or the opener did not open it
 * (`unopened`), with what the toast says.
 */
type OwnOpen = { kind: 'opened' } | { kind: 'busy' } | { kind: 'down'; why: string } | { kind: 'unopened'; why: string }

/**
 * "Open in browser" (at the right of the deck's header, `o`, and in
 * Settings): starts the web deck when it is not running (`ensureWeb`, and
 * its toast when it could not; a second press while it starts does
 * nothing), but never opens the Browser pane; then a `full` link made for
 * this press, opened in your own browser (`ownBrowserOpen`); a toast when it
 * could not (the terminal shows a link to copy).
 */
export async function openOwnBrowser($: EngineInterface): Promise<void> {
  const opened = await ownBrowserOpen($)
  if (opened.kind === 'unopened') $.ui.toast(`Could not open your browser${opened.why ? ` (${F.trunc(F.oneLine(opened.why), 120)})` : ''}. In a terminal, the deck shows the link to copy under its header.`)
}

/**
 * The page in your own browser: the web deck started first when it is not
 * running (its toast when it could not), then a `full` link made for this
 * try, opened by the system's opener (web/open.js: osascript's `open
 * location` read on its stdin on macOS, so no process's arguments ever hold
 * it; `start`, `xdg-open` elsewhere, whose arguments do while they run), the
 * link on its stdin. Its ticket works for `W.OPENER_TICKET_MS` only, unless
 * the page traded it by then.
 */
async function ownBrowserOpen($: EngineInterface): Promise<OwnOpen> {
  if (web.status !== 'running' || web.port <= 0) {
    if (isBrowserWaiting) return { kind: 'busy' }
    if (web.isEnded) {
      $.ui.toast(WEB_ENDED_TEXT)
      return { kind: 'down', why: WEB_ENDED_TEXT }
    }
    isBrowserWaiting = true
    let isUp = false
    try {
      isUp = await ensureWeb($)
    } finally {
      isBrowserWaiting = false
    }
    if (!isUp) {
      const why = webDownWhy()
      $.ui.toast(`Apiarius web: ${why}`)
      return { kind: 'down', why }
    }
  }
  const until = Math.ceil(((await $.clock.now()) + W.OPENER_TICKET_MS) / 1000)
  const ticket = web.status === 'running' && web.port > 0 ? ticketFor('full', until) : ''
  if (ticket === '') {
    $.ui.toast('Apiarius web is not running: Open in browser starts it.')
    return { kind: 'down', why: 'Apiarius web is not running.' }
  }
  let why = ''
  try {
    const ran = await $.process.run(['node', `${$.plugin.root.replace(/[\\/]+$/, '')}/web/open.js`], { stdin: `${W.webUrlOf(web.port, ticket)}\n`, timeoutMs: 10_000, ...(nodeCwd() ? { cwd: nodeCwd() } : {}) })
    if (ran.exitCode === 0 && W.isHomeDone(ran.stdout)) return { kind: 'opened' }
    why = W.openWhyOf(ran.stdout)
  } catch (error) {
    why = error instanceof Error ? error.message : String(error)
  }
  return { kind: 'unopened', why }
}

/** `/apiarius web stop`: the server ends, the state is no longer written, and the next start makes a new link. Answers whether it was on. */
export function stopWeb($: EngineInterface): boolean {
  const wasOn = web.isOn || web.status === 'running' || web.status === 'starting'
  web.isOn = false
  web.isAsked = false
  web.secret = ''
  web.shown = ''
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

/**
 * A /clear or a resume: what the folder held of the conversation before (its
 * state, patches, messages, agent files, git's diffs, Timeline) goes, its
 * inbox kept, and what the deck wrote is forgotten, so the next write makes
 * each file afresh (0600 again).
 */
export async function clearWeb($: EngineInterface): Promise<void> {
  const id = W.idOfWebDir(home, web.dir)
  web.gen += 1
  await web.writing
  web.written.clear()
  web.gitDiffsWritten.clear()
  web.agentFiles.clear()
  web.made.clear()
  web.lastKey = ''
  timelineWritten.key = ''
  if (id !== '') await runHome($, { op: 'clear', home, id })
}

/**
 * The session ended: the server stopped, nothing written again, and its
 * state folder removed whole (the one the server served, and the one its
 * id names, if a reload after a /clear moved it). A folder a crash left is
 * swept at the next start instead.
 */
export async function endWeb($: EngineInterface): Promise<void> {
  web.isEnded = true
  web.isAsked = false
  web.gen += 1
  timers.web?.cancel()
  timers.web = undefined
  web.stop?.()
  await web.writing
  const ids = [...new Set([W.idOfWebDir(home, web.dir), W.idOfWebDir(home, W.webDirOf(home, currentSessionId()))])].filter(id => id !== '')
  if (ids.length > 0) await runHome($, { op: 'remove', home, ids })
}
