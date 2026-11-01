/**
 * Every session on this machine: each
 * session's deck keeps a small file in a folder of the person's own, and
 * every deck reads the others' to list them.
 *
 * - **The registry.** `<registry>/<sessionId>.json` (`SessionEntry`), where
 *   the registry is `~/.claude/apiarius/sessions` (`registryDirOf`). A deck
 *   writes its own when what it shows changes (at most every 2 s) and on a
 *   heartbeat (every 30 s), and lets it go on `session.end`. A file whose
 *   heartbeat stopped is no session's any more: left out at once, and cleaned
 *   once its process is gone (or long after).
 * - **The list** (`SessionsV2`, the v2 state's `sessions`): each session's
 *   state in a word, its title, where it runs, what it waits on you for or
 *   what it is doing, its agents at work and in all (the first three at
 *   work as its deck draws them: its row's faces), its spend (/cost's
 *   estimate at API list prices, a fork's counting its parent's) and how
 *   long since it changed; one whose deck has not been heard from lately
 *   says when it was ("Last heard 2m ago"), not a state that may be stale.
 *   The session the deck belongs to first ("here"), then the others, the
 *   newest started first, so rows stay put whatever their states do.
 * - **Showing one.** A session's deck shows from its state folder (the
 *   `state.json` and lazy files `/apiarius web` writes). A deck writes them only
 *   while it is asked to: another deck showing it says so in its inbox
 *   (`InboxFile.viewUntil`), as long as it looks. Its controls are its own
 *   window's; a permission prompt alone, which Claude Code takes only in its
 *   own window, says so where it stands (`peerStateOf`, `inItsWindow`).
 * - **Steering one.** Every press on its deck goes to its own deck (`STEERING`:
 *   an answer, a message, Stop, Stop turn, Cancel, Clear finished, a pick of
 *   Changes, Review), which runs it as its own page's, through Claude Code's
 *   channels and with its own checks: the viewer writes the command into
 *   `<dir>/inbox/<its own id>.json`, the session's deck reads it on its tick,
 *   and its ack shows in its state, at the control pressed (`pressesOf`). A
 *   deck gone quiet, or one that reads none (`inbox: false`, an older
 *   build), says so at its controls before a press (`notAnsweringOf`).
 *
 * Pure: the hooks module does the reading, writing and timing.
 */
import * as AV from '../web/avatars.mjs'
import type { V2Stop } from './background'
import * as F from './format'
import type { V2AgentRow, V2Need, V2Peer, V2Press, WebAck, WebStateV2 } from './web'

/** The registry file's version. */
export const REGISTRY_V = 1
/** How often a deck says it lives, though nothing changed. */
export const HEARTBEAT_MS = 30_000
/** At most this often a change of what a session shows is written. */
export const ENTRY_WRITE_MS = 2_000
/** No heartbeat for this long: the session is gone, or hung; it is left out of the list. */
export const STALE_MS = 3 * 60_000
/** No heartbeat heard for this long (two missed, and a read's lag): its row says when it was last heard, not a state that may be stale. */
export const QUIET_MS = 90_000
/** No heartbeat for this long: cleaned whatever its process says (an id the system gave another). */
export const GONE_MS = 30 * 60_000
/** A view request keeps a session's state written this long. */
export const VIEW_MS = 90_000
/** A viewer asks again this often while it looks. */
export const VIEW_AGAIN_MS = 30_000
/** How long a viewer waits for another session's deck to write its state before it says it has not: one answers within a tick or two (2.5 s each). */
export const ANSWER_MS = 10_000
/** A command older than this in an inbox is let go unread: it was meant for a moment past. */
export const COMMAND_MS = 2 * 60_000
/** The commands an inbox file keeps, newest last. */
export const INBOX_MOST = 20

/** Where a session draws: Claude Code's surfaces (`$.session.surfaces()`); '' when none is attached (a `-p` run, or before the Desktop attaches). */
export type SessionSurface = 'desktop' | 'terminal' | 'vscode' | 'mobile' | ''

/** One session's file in the registry, `<registry>/<sessionId>.json`, as its deck writes it, sealed (./seal `ENTRY`): a deck lists no session whose file's seal is not its own. */
export type SessionEntry = {
  v: 1
  /** The session's id (its transcript's name). */
  id: string
  /** Its title: your latest request's headline, as its header shows it; '' before the first. */
  title: string
  /** Where it runs. */
  cwd: string
  /** Its repository's folder name; '' outside one. */
  repo: string
  /** Where it draws. */
  surface: SessionSurface
  /** The terminal program a terminal session runs in, as its environment names it (`Windows Terminal`, `vscode`); '' when it says none. */
  terminal: string
  /** Its header's word. */
  state: 'working' | 'waiting' | 'idle'
  /** The first thing that needs you, in a line ("Orchestrator asks: Which store…"); null when nothing does. */
  need: string | null
  /** How many things need you there. */
  needs: number
  /** How many of its agents are at work (the Orchestrator and Claude Code's own loops left out). */
  working: number
  /** How many agents it shows in all, at work or not (the Orchestrator, Claude Code's own loops and those Clear finished hid left out); 0 from an older build. */
  agents: number
  /** Its first agents at work (`MOST_FACES`), in its deck's order, each as its deck draws it: the faces its row shows. None from an older build. */
  faces: SessionFace[]
  /** What it is doing, in a line, from its rows' calls in flight ("builder: Bash npm test"), else its latest answer when idle; '' for neither. */
  live: string
  /** Its spend, as /cost reports it (an estimate at API list prices); null while unknown. */
  costUsd: number | null
  /** It began as a fork of another session (Claude Code's SessionStart said so): its spend counts that one's. The engine does not say which. Absent for any other. */
  isFork?: true
  startedAt: number
  /** When what it shows last changed. */
  updatedAt: number
  /** When its deck last said it lives. */
  heartbeatAt: number
  /** Its process (the engine's), to tell when it is gone; null when its deck could not read it. */
  pid: number | null
  /** Its state folder (`<home>/web/<sessionId>`, `homeDirOf`): `state.json`, its lazy files and its inbox. */
  dir: string
  /** Its deck reads view requests and commands from its inbox. */
  inbox: boolean
  /** Set by `session.end` before the file goes: it ended. */
  endedAt?: number
}

/**
 * One of a session's agents at work, as its own deck draws its avatar: its
 * id (the face's seed), its title (its name: a monogram's letters), its
 * status, and how far through its own TodoWrite list it is (0 to 1; left
 * out with none).
 */
export type SessionFace = { id: string; title: string; status: 'starting' | 'running'; progress?: number }

/** One row of the list: a session as every surface shows it. */
export type SessionRowV2 = {
  id: string
  /** Here: the session whose deck draws the list (the page's or the pane's own), tagged "here". */
  isMe: boolean
  /** Its title, else "No request yet". */
  title: string
  state: SessionEntry['state']
  /** "Working", "Waiting on you", "Idle"; '' for a quiet one, whose state may be stale. */
  stateText: string
  surface: SessionSurface
  /** Where it runs, in words: "Desktop", "Terminal · Windows Terminal", "VS Code"; '' when no surface is attached. */
  place: string
  /** Its repository's name, else its folder's. */
  repo: string
  /** Its window, as a row and a note name it: its place and repository ("Terminal · cd_deck"). */
  where: string
  cwd: string
  /** The first thing that needs you there, in a line; null when nothing does, and for a quiet one. */
  need: string | null
  /** How many things need you there (a row's amber badge); 0 for a quiet one. */
  needs: number
  /** What the row says under its title: the need, else what it is doing (derived from its calls), else ''; a quiet one's, when its deck was last heard ("Last heard 2m ago"). */
  say: string
  /** Its agents at work, and in all (`SessionEntry`'s): "3 agents working". */
  working: number
  agents: number
  /** Its first agents at work as its deck draws them (`SessionEntry`'s): its row's faces (`facesOf`). */
  faces: SessionFace[]
  costUsd: number | null
  /** "≈$4.12", whole dollars from $100 ("≈$491"); '' while unknown. */
  cost: string
  /** Under it, for a fork's: "incl. its parent's" (its spend began at the session it was forked from); '' for any other, and while the spend is unknown. */
  costNote: string
  /** When what it shows last changed, and how long ago: "now", "3m", "2h". */
  at: number
  age: string
  startedAt: number
  /** Its deck has not been heard from for `QUIET_MS`: its row says when it was (`say`, `heardAt`) and no state word, need or face; it is counted nowhere. Never here's. */
  isQuiet: boolean
  /** When its deck was last heard (its heartbeat), for a quiet one; 0 for one heard lately, so a heartbeat changes nothing in the list. */
  heardAt: number
  /** A deck can open it: it names its state folder (where a deck reads, that folder is checked to be one the deck makes, `isStateDirOf`). */
  canOpen: boolean
  /** Its deck takes answers and messages from another deck (its inbox); otherwise answer it in its window. */
  canSteer: boolean
}

/** The list, as the v2 state carries it (`sessions`). */
export type SessionsV2 = {
  rows: SessionRowV2[]
  /** "5 on this machine · 2 waiting on you · 2 working". */
  text: string
  /** The other sessions waiting on you and at work: the band's "◆ 1 other session needs you". */
  others: { waiting: number; working: number }
  /** Every session heard lately, here's too: how many wait on you and work, and their agents at work ("This machine": "◆ 1 needs you · 3 agents working"). */
  machine: { waiting: number; working: number; agents: number }
}

/** The view and the steering a viewer writes into a session's inbox, `<dir>/inbox/<viewer's id>.json`, whole each time, sealed (./seal `INBOX`): a deck takes nothing from a file whose seal is not its own. */
export type InboxFile = {
  v: 1
  /** The viewer's session id. */
  from: string
  /** The session it is written for: a file moved to another session's inbox is no command of the viewer's there. */
  to: string
  /** When it was written. */
  at: number
  /** Until when the viewer looks: the session writes its state folder till then; 0 when it looks no more. */
  viewUntil: number
  /** Its commands, oldest first, the newest 20: one of `STEERING`, each with its own `id` (its ack's). */
  cmds: InboxCommand[]
}

/**
 * One command in an inbox: a page command (`STEERING`) as the page sends
 * it, with its `id`, when it was given, and the process the session it went
 * to ran in then (its registry file's `pid`): a session started again in
 * another process (a resume) takes none given before, though the viewer
 * writes them again.
 */
export type InboxCommand = { at: number; cmd: Record<string, unknown>; pid: number | null }

const STATE_TEXT: Readonly<Record<SessionEntry['state'], string>> = { working: 'Working', waiting: 'Waiting on you', idle: 'Idle' }

const SURFACE_WORD: Readonly<Record<Exclude<SessionSurface, ''>, string>> = { desktop: 'Desktop', terminal: 'Terminal', vscode: 'VS Code', mobile: 'Mobile' }

/** The commands a deck takes from another session's deck: every one of its page's that is about its session. The avatar style is the person's, for every session, so it never goes to another. */
export const STEERING: readonly string[] = ['chat', 'answer', 'stopAgent', 'abortTurn', 'stopBackground', 'clearFinished', 'showCleared', 'selectRepo', 'review']

/** How long a press on another session's deck shows what came of it, once its ack came. */
export const PRESS_SHOWN_MS = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The id a command carries for its ack: `[A-Za-z0-9_-]{1,40}`, as the page's (./web `cmdIdOf`). */
const CMD_ID = /^[A-Za-z0-9_-]{1,40}$/

/**
 * A command from another session's deck rebuilt from exactly its known keys,
 * each checked as web/server.js checks the page's: its `id` (which the ack
 * names), `chat`'s agent and words, `answer`'s call and one to four answers,
 * `stopAgent`'s agent, `abortTurn`'s turn (optional), `stopBackground`'s row,
 * `selectRepo`'s root (one line, '' to follow the work), `review`'s words;
 * `clearFinished` and `showCleared` name nothing. Null for any other shape,
 * and for a command not in `STEERING`.
 */
export function steeringCmdOf(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !CMD_ID.test(value.id)) return null
  const id = value.id
  const keys = Object.keys(value)
    .filter(key => key !== 'id')
    .sort()
    .join(',')
  const isText = (text: unknown): text is string => typeof text === 'string' && text.trim() !== '' && text.length <= 4000
  const isName = (name: unknown): name is string => typeof name === 'string' && /^[^\u0000-\u001f\u007f-\u009f]{1,200}$/.test(name)
  const isWebId = (said: unknown, most: number): said is string => typeof said === 'string' && said.length <= most && /^[A-Za-z0-9_-]+$/.test(said)
  if (value.cmd === 'chat' && keys === 'agentId,cmd,text' && isName(value.agentId) && isText(value.text)) return { cmd: 'chat', id, agentId: value.agentId, text: value.text }
  if (value.cmd === 'answer' && keys === 'answers,callId,cmd' && isWebId(value.callId, 100) && isRecord(value.answers)) {
    const answers = Object.entries(value.answers)
    const isAnswer = (text: unknown) => typeof text === 'string' && text.trim() !== '' && text.length <= 2000
    if (answers.length >= 1 && answers.length <= 4 && answers.every(([question, answer]) => isAnswer(question) && isAnswer(answer))) return { cmd: 'answer', id, callId: value.callId, answers: Object.fromEntries(answers) }
  }
  if (value.cmd === 'stopAgent' && keys === 'agentId,cmd' && isName(value.agentId)) return { cmd: 'stopAgent', id, agentId: value.agentId }
  if (value.cmd === 'abortTurn' && keys === 'cmd') return { cmd: 'abortTurn', id }
  if (value.cmd === 'abortTurn' && keys === 'cmd,turnId' && isWebId(value.turnId, 100)) return { cmd: 'abortTurn', id, turnId: value.turnId }
  if (value.cmd === 'stopBackground' && keys === 'bgId,cmd' && isWebId(value.bgId, 200)) return { cmd: 'stopBackground', id, bgId: value.bgId }
  if ((value.cmd === 'clearFinished' || value.cmd === 'showCleared') && keys === 'cmd') return { cmd: value.cmd, id }
  if (value.cmd === 'selectRepo' && keys === 'cmd,root' && typeof value.root === 'string' && /^[^\u0000-\u001f\u007f-\u009f]{0,1000}$/.test(value.root)) return { cmd: 'selectRepo', id, root: value.root }
  if (value.cmd === 'review' && keys === 'cmd,text' && isText(value.text)) return { cmd: 'review', id, text: value.text }
  return null
}

/** Why another session's deck refused a command `steeringCmdOf` could not read, as its ack says it. */
export function steeringRefusalOf(value: unknown): string {
  const cmd = isRecord(value) && typeof value.cmd === 'string' ? value.cmd : ''
  if (!STEERING.includes(cmd)) return `Not a command another session's deck sends${cmd !== '' ? `: ${F.trunc(F.oneLine(cmd), 40)}` : ''}`
  return 'Not a command the deck can read'
}

/** What a control of another session's says, before a press, while its deck takes nothing from here; where there is room, why (`notAnsweringOf`). */
export const NOT_ANSWERING = "Its deck isn't answering"

/**
 * Why another session's controls do nothing from here, said at each before
 * a press; '' while its deck takes commands from here: one not heard from
 * lately ("Its deck isn't answering: last heard 2m ago."), one that reads no
 * inbox (an older build), one the list holds no more.
 */
export function notAnsweringOf(row: Pick<SessionRowV2, 'canSteer' | 'isQuiet' | 'say'> | null): string {
  if (!row) return `${NOT_ANSWERING}: it is not listed any more.`
  if (row.isQuiet) return `${NOT_ANSWERING}: ${row.say !== '' ? `${row.say.charAt(0).toLowerCase()}${row.say.slice(1)}` : 'not heard from lately'}.`
  if (!row.canSteer) return `${NOT_ANSWERING}: it runs an older Apiarius.`
  return ''
}

/** A press sent to another session's deck from here: its command's id, when it went, what its control says until the ack ("Stopping…"), and why it could not go ('' when it went). */
export type PressSent = { id: string; at: number; doing: string; failed: string }

/**
 * What each press sent to another session's deck says at its control, by
 * its key, from that deck's acks: `sending` until its ack, then `done` or
 * `failed` with the ack's words, for `PRESS_SHOWN_MS`; one that could not go
 * `failed` with why; one that heard nothing within `COMMAND_MS` (its deck
 * lets such a command go unread) `failed`, its deck did not answer. Those
 * past showing are left out.
 */
export function pressesOf(sent: ReadonlyMap<string, PressSent>, acks: readonly WebAck[], now: number): Record<string, V2Press> {
  const out: Record<string, V2Press> = {}
  for (const [key, one] of sent) {
    const ack = [...acks].reverse().find(said => said.id === one.id)
    if (one.failed !== '') {
      if (now - one.at <= PRESS_SHOWN_MS) out[key] = { status: 'failed', text: one.failed }
    } else if (ack) {
      if (now - Math.max(ack.at, one.at) <= PRESS_SHOWN_MS) out[key] = { status: ack.ok && ack.status !== 'failed' ? 'done' : 'failed', text: ack.text }
    } else if (now - one.at <= COMMAND_MS) out[key] = { status: 'sending', text: one.doing }
    else if (now - one.at <= COMMAND_MS + PRESS_SHOWN_MS) out[key] = { status: 'failed', text: 'Its deck did not answer: it may be busy or gone' }
  }
  return out
}

/** A session id as a file name: `[A-Za-z0-9_-]`, 1 to 100 characters; '' for anything else. */
export function sessionFileOf(id: string): string {
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : ''
}

/**
 * The registry folder: `APIARIUS_SESSIONS` when set (the tests', and a
 * person's own choice), else `sessions` in Apiarius's home (`homeDirOf`);
 * '' when no home is known.
 */
export function registryDirOf(env: { override?: string | undefined; apiariusHome?: string | undefined; configDir?: string | undefined; home?: string | undefined }): string {
  if (env.override && env.override.trim() !== '') return env.override.trim().replace(/[\\/]+$/, '')
  const home = homeDirOf(env)
  return home === '' ? '' : `${home}/sessions`
}

/**
 * Apiarius's home, where all it keeps lies (the registry, each session's
 * state folder, the debug dump), outside any project and the mod's own
 * folder: `APIARIUS_HOME` when set, else `apiarius` under Claude Code's
 * configuration folder; '' when no home is known.
 */
export function homeDirOf(env: { apiariusHome?: string | undefined; configDir?: string | undefined; home?: string | undefined }): string {
  if (env.apiariusHome && env.apiariusHome.trim() !== '') return env.apiariusHome.trim().replace(/[\\/]+$/, '')
  const config = configDirOf(env)
  return config === '' ? '' : `${config}/apiarius`
}

/** Claude Code's configuration folder: `CLAUDE_CONFIG_DIR`, else `~/.claude`; '' when no home is known. */
export function configDirOf(env: { configDir?: string | undefined; home?: string | undefined }): string {
  const trim = (path: string) => path.replace(/[\\/]+$/, '')
  if (env.configDir && env.configDir.trim() !== '') return trim(env.configDir.trim())
  if (env.home && env.home.trim() !== '') return `${trim(env.home.trim())}/.claude`
  return ''
}

/** A session's file in the registry; '' for an id no file can carry. */
export function entryPathOf(registry: string, id: string): string {
  const name = sessionFileOf(id)
  return registry !== '' && name !== '' ? `${registry}/${name}.json` : ''
}

/** The inbox a viewer writes into: `<dir>/inbox/<viewer's id>.json`; '' for an id no file can carry. */
export function inboxPathOf(dir: string, from: string): string {
  const name = sessionFileOf(from)
  return dir !== '' && name !== '' ? `${dir.replace(/[\\/]+$/, '')}/inbox/${name}.json` : ''
}

/**
 * Whether `dir` is session `id`'s state folder as the deck makes them,
 * `<home>/web/<id>` under this deck's own home (`webRoot`, `<home>/web`): the
 * only folders a viewer reads or writes. Any other path is refused, a
 * folder elsewhere named the same way included.
 */
export function isStateDirOf(dir: string, id: string, webRoot: string): boolean {
  const norm = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')
  const name = sessionFileOf(id)
  const root = norm(webRoot)
  if (name === '' || root === '') return false
  const parts = norm(dir).split('/')
  return !parts.includes('..') && !parts.includes('.') && norm(dir) === `${root}/${name}`
}

/** Where a session runs, in words: "Desktop", "Terminal · Windows Terminal"; '' with no surface. */
export function placeOf(surface: SessionSurface, terminal: string): string {
  if (surface === '') return ''
  const word = SURFACE_WORD[surface]
  return surface === 'terminal' && terminal !== '' ? `${word} · ${terminal}` : word
}

/** The surface a session draws on, of those Claude Code says it draws on: the Desktop's first, then VS Code's, the terminal, the phone. */
export function surfaceOf(surfaces: readonly string[]): SessionSurface {
  for (const one of ['desktop', 'vscode', 'terminal', 'mobile'] as const) if (surfaces.includes(one)) return one
  return ''
}

/** The terminal program, as its environment names it: Windows Terminal (`WT_SESSION`), else `TERM_PROGRAM` verbatim; '' for neither. */
export function terminalOf(env: { wtSession?: string | undefined; termProgram?: string | undefined }): string {
  if (env.wtSession) return 'Windows Terminal'
  return env.termProgram ? F.trunc(F.oneLine(env.termProgram), 30) : ''
}

/** A need in one line, as the list says it: "Orchestrator asks: Which store…", "Needs your OK: Bash npm test", a notification's words. */
export function needLineOf(need: V2Need): string {
  if (need.kind === 'question') {
    const first = need.questions?.[0]?.question ?? need.text
    return F.trunc(F.oneLine(`${need.agentName} asks: ${first}`), 160)
  }
  if (need.kind === 'permission') {
    const what = need.command ?? need.path ?? need.description ?? ''
    return F.trunc(F.oneLine(`Needs your OK: ${need.tool ?? ''} ${what}`), 160)
  }
  return F.trunc(F.oneLine(`${need.agentName}: ${need.text || need.title || need.type || ''}`), 160)
}

/** Whether a row is an agent at work: not the Orchestrator, not Claude Code's own loop, starting or running. */
function isWorkingAgent(row: V2AgentRow): boolean {
  return row.kind !== 'orchestrator' && row.kind !== 'engine' && (row.status === 'running' || row.status === 'starting')
}

/** An agent at work as its row's face: as its deck's avatar takes it (./ui/v2/look `avatarAgentOf`: seeded by its id, named by its title), its own list's progress where it keeps one. */
function faceOf(row: V2AgentRow): SessionFace {
  const progress = AV.progressOf(row.todos)
  return { id: row.id, title: row.title, status: row.status === 'starting' ? 'starting' : 'running', ...(progress !== undefined ? { progress } : {}) }
}

/** A file's faces, each checked (an id and a title; at work; progress 0 to 1), three at most; none from an older build's, which names none. */
function facesFrom(value: unknown): SessionFace[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .filter(one => typeof one.id === 'string' && one.id !== '' && one.id.length <= 200 && typeof one.title === 'string')
    .slice(0, MOST_FACES)
    .map(one => ({
      id: one.id as string,
      title: F.trunc(one.title as string, 120),
      status: one.status === 'starting' ? 'starting' : 'running',
      ...(typeof one.progress === 'number' && Number.isFinite(one.progress) ? { progress: Math.min(1, Math.max(0, one.progress)) } : {}),
    }))
}

/**
 * What a session is doing, in a line, from its own rows: "2 agents working
 * · builder: Bash npm test" (the first agent with a call in flight), the
 * Orchestrator's call in flight ("Orchestrator: Bash gh run view"), or idle,
 * its latest answer ('Finished: “Synced 14 notebooks.”'); '' for none.
 */
export function liveLineOf(state: Pick<WebStateV2, 'agents' | 'header'>): string {
  const rows = state.agents.filter((row): row is V2AgentRow => row.row === 'agent' && row.isCleared !== true)
  const working = rows.filter(isWorkingAgent)
  const call = (row: V2AgentRow) => (row.live ? `${row.title}: ${row.live.tool} ${row.live.text}`.trim() : '')
  const main = rows.find(row => row.kind === 'orchestrator')
  const busy = working.find(row => row.live !== null)
  if (working.length > 0) {
    const count = F.plural(working.length, 'agent')
    return F.trunc(F.oneLine(busy ? `${count} working · ${call(busy)}` : `${count} working`), 160)
  }
  if (main?.live) return F.trunc(F.oneLine(call(main)), 160)
  if (state.header.state === 'idle' && main && main.result.trim() !== '') return F.trunc(F.oneLine(`Finished: “${F.firstLine(main.result)}”`), 160)
  return ''
}

/** What a session's deck writes about it: its v2 state in a line or two, and the facts its deck read (`facts`). Its times are the caller's. */
export function entryOf(
  state: WebStateV2,
  facts: { surface: SessionSurface; terminal: string; repo: string; pid: number | null; dir: string; updatedAt: number; heartbeatAt: number },
): SessionEntry {
  const need = state.needs[0]
  const atWork = state.agents.filter((row): row is V2AgentRow => row.row === 'agent' && isWorkingAgent(row))
  return {
    v: REGISTRY_V,
    id: state.session.id,
    title: state.header.goal ? F.trunc(F.oneLine(state.header.goal.headline), 120) : '',
    cwd: state.session.cwd,
    repo: facts.repo !== '' ? facts.repo : (state.changes.repo?.name ?? ''),
    surface: facts.surface,
    terminal: facts.terminal,
    state: state.header.state,
    need: need ? needLineOf(need) : null,
    needs: state.needs.length,
    working: atWork.length,
    agents: state.agents.filter(row => row.row === 'agent' && row.kind !== 'orchestrator' && row.kind !== 'engine' && row.isCleared !== true).length,
    faces: atWork.slice(0, MOST_FACES).map(faceOf),
    live: liveLineOf(state),
    costUsd: state.header.costUsd,
    ...(state.session.isFork === true ? { isFork: true as const } : {}),
    startedAt: state.session.startedAt,
    updatedAt: facts.updatedAt,
    heartbeatAt: facts.heartbeatAt,
    pid: facts.pid,
    dir: facts.dir,
    inbox: true,
  }
}

/** What an entry says, its times left out: equal keys need no write but the heartbeat's. */
export function entryKeyOf(entry: SessionEntry): string {
  return JSON.stringify({ ...entry, updatedAt: 0, heartbeatAt: 0 })
}

/** A registry file read as it stands (its seal not checked: the sample's, `/apiarius demo`): the entry, every field checked; null for anything else (a half-written file, another program's). */
export function entryFromText(text: string): SessionEntry | null {
  try {
    return entryFrom(JSON.parse(text))
  } catch {
    return null
  }
}

/** A registry file's value (its seal checked and left out, ./seal `openedOf`): the entry, every field checked; null for anything else. */
export function entryFrom(value: unknown): SessionEntry | null {
  if (!isRecord(value) || value.v !== REGISTRY_V || typeof value.id !== 'string' || sessionFileOf(value.id) === '') return null
  const str = (one: unknown, most = 400) => (typeof one === 'string' ? F.trunc(one, most) : '')
  const num = (one: unknown) => (typeof one === 'number' && Number.isFinite(one) ? one : 0)
  const state = value.state === 'working' || value.state === 'waiting' ? value.state : 'idle'
  const surface: SessionSurface = value.surface === 'desktop' || value.surface === 'terminal' || value.surface === 'vscode' || value.surface === 'mobile' ? value.surface : ''
  const pid = typeof value.pid === 'number' && Number.isInteger(value.pid) && value.pid > 0 ? value.pid : null
  return {
    v: REGISTRY_V,
    id: value.id,
    title: str(value.title, 120),
    cwd: str(value.cwd, 1000),
    repo: str(value.repo, 200),
    surface,
    terminal: str(value.terminal, 40),
    state,
    need: typeof value.need === 'string' && value.need !== '' ? F.trunc(value.need, 200) : null,
    needs: Math.max(0, num(value.needs)),
    working: Math.max(0, num(value.working)),
    agents: Math.max(0, num(value.agents), num(value.working)),
    faces: facesFrom(value.faces),
    live: str(value.live, 200),
    costUsd: typeof value.costUsd === 'number' && Number.isFinite(value.costUsd) ? value.costUsd : null,
    ...(value.isFork === true ? { isFork: true as const } : {}),
    startedAt: num(value.startedAt),
    updatedAt: num(value.updatedAt),
    heartbeatAt: num(value.heartbeatAt),
    pid,
    dir: str(value.dir, 1000),
    inbox: value.inbox === true,
    ...(typeof value.endedAt === 'number' && value.endedAt > 0 ? { endedAt: value.endedAt } : {}),
  }
}

/** Whether an entry is a live session's: not ended, its heartbeat within `STALE_MS`. */
export function isLiveEntry(entry: SessionEntry, now: number): boolean {
  return entry.endedAt === undefined && now - entry.heartbeatAt <= STALE_MS
}

/** Whether a live entry's deck has gone quiet: no heartbeat heard for `QUIET_MS`, so what it last said may be stale. */
export function isQuietEntry(entry: SessionEntry, now: number): boolean {
  return now - entry.heartbeatAt > QUIET_MS
}

/**
 * What to do with a registry file: `keep` a live session's; `check` one
 * whose heartbeat stopped while its process may still run (ask the system,
 * then call again with `isAlive`); `gone`, clean it: it ended, its process
 * is gone (or unknown), or it is past `GONE_MS`.
 */
export function staleStepOf(entry: SessionEntry, now: number, isAlive: boolean | null = null): 'keep' | 'check' | 'gone' {
  if (entry.endedAt !== undefined) return 'gone'
  const silent = now - entry.heartbeatAt
  if (silent <= STALE_MS) return 'keep'
  if (silent > GONE_MS || entry.pid === null || isAlive === false) return 'gone'
  return isAlive === true ? 'keep' : 'check'
}

/** "≈$4.12", /cost's estimate at API list prices, whole dollars from $100 ("≈$491", so it keeps to its column); '' while unknown. */
function costOf(usd: number | null): string {
  if (usd === null) return ''
  return usd < 100 ? `≈$${usd.toFixed(2)}` : `≈$${Math.round(usd)}`
}

/** A folder's last part: the place a session runs in when it has no repository. */
function folderOf(path: string): string {
  return F.baseName(path.replace(/[\\/]+$/, ''))
}

/**
 * The list every surface shows, from the registry's live entries and this
 * deck's own (`me`, here, always shown, though its file is not read back
 * yet): here first, then the others, the newest started first, so rows keep
 * their places whatever their sessions do (what needs you is counted, not
 * moved up). A quiet one is counted nowhere.
 */
export function sessionsViewOf(entries: readonly SessionEntry[], me: SessionEntry | null, now: number): SessionsV2 {
  const live = entries.filter(entry => isLiveEntry(entry, now) && entry.id !== me?.id)
  const others = [...live].sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
  const rows = [...(me ? [rowOf(me, true, now)] : []), ...others.map(entry => rowOf(entry, false, now))]
  const heard = rows.filter(row => !row.isQuiet)
  const waiting = heard.filter(row => row.state === 'waiting').length
  const working = heard.filter(row => row.state === 'working').length
  const text = [`${rows.length} on this machine`, waiting > 0 ? `${waiting} waiting on you` : '', working > 0 ? `${working} working` : ''].filter(part => part !== '').join(' · ')
  const otherRows = heard.filter(row => !row.isMe)
  return {
    rows,
    text,
    others: { waiting: otherRows.filter(row => row.state === 'waiting').length, working: otherRows.filter(row => row.state === 'working').length },
    machine: { waiting, working, agents: heard.reduce((n, row) => n + row.working, 0) },
  }
}

function rowOf(entry: SessionEntry, isMe: boolean, now: number): SessionRowV2 {
  const canOpen = entry.dir !== ''
  const place = placeOf(entry.surface, entry.terminal)
  const repo = entry.repo !== '' ? entry.repo : folderOf(entry.cwd)
  // what it last said may be stale: when it was last heard stands in for its state, its need and what it does
  const isQuiet = !isMe && isQuietEntry(entry, now)
  return {
    id: entry.id,
    isMe,
    title: entry.title !== '' ? entry.title : 'No request yet',
    state: entry.state,
    stateText: isQuiet ? '' : STATE_TEXT[entry.state],
    surface: entry.surface,
    place,
    repo,
    where: [place, repo].filter(part => part !== '').join(' · '),
    cwd: entry.cwd,
    need: isQuiet ? null : entry.need,
    needs: isQuiet ? 0 : entry.needs,
    say: isQuiet ? heardOf(entry.heartbeatAt, now) : (entry.need ?? entry.live),
    working: entry.working,
    agents: entry.agents,
    faces: entry.faces,
    costUsd: entry.costUsd,
    cost: costOf(entry.costUsd),
    costNote: entry.isFork === true && entry.costUsd !== null ? 'incl. its parent’s' : '',
    at: entry.updatedAt,
    age: entry.updatedAt > 0 ? F.since(now - entry.updatedAt) : '',
    startedAt: entry.startedAt,
    isQuiet,
    heardAt: isQuiet ? entry.heartbeatAt : 0,
    canOpen,
    canSteer: canOpen && entry.inbox,
  }
}

/** A quiet deck's line: "Last heard 2m ago". */
export function heardOf(heardAt: number, now: number): string {
  const ago = F.since(now - heardAt)
  return ago === 'now' ? 'Last heard just now' : `Last heard ${ago} ago`
}

/** The list's ages worded again at `now` (the pane builds its screens anew; the rows' `at` and `heardAt` stay). */
export function sessionsAgedOf(view: SessionsV2, now: number): SessionsV2 {
  return { ...view, rows: view.rows.map(row => ({ ...row, age: row.at > 0 ? F.since(now - row.at) : '', ...(row.isQuiet ? { say: heardOf(row.heardAt, now) } : {}) })) }
}

/** "This machine" in words: "◆ 1 needs you" (amber; '' while none does), then "3 agents working", "1 session working" while only Orchestrators work, else "Nothing at work". */
export function machineLineOf(view: Pick<SessionsV2, 'machine'>): { need: string; rest: string } {
  const { waiting, working, agents } = view.machine
  const need = waiting > 0 ? `◆ ${waiting} ${waiting === 1 ? 'needs' : 'need'} you` : ''
  const rest = agents > 0 ? `${F.plural(agents, 'agent')} working` : working > 0 ? `${F.plural(working, 'session')} working` : 'Nothing at work'
  return { need, rest }
}

/** The sessions other than the one shown (`shownId`) waiting on you, heard lately: the switcher's "◆ 1 needs you" (the one shown says its own). */
export function othersWaitingOf(view: Pick<SessionsV2, 'rows'>, shownId: string): number {
  return view.rows.filter(row => row.id !== shownId && !row.isQuiet && row.state === 'waiting').length
}

/** The faces most a row draws. */
export const MOST_FACES = 3

/**
 * The faces a row draws while its session works: its agents at work, each
 * as its own deck draws it (`SessionFace`: seeded by its id, named by its
 * title), at most three, then how many more are at work. None while it does
 * not work or is quiet, none for the Orchestrator (the row's dot says the
 * session works), and none from an older build's file, which names none:
 * a row never draws a face that is not one of its agents.
 */
export function facesOf(row: Pick<SessionRowV2, 'state' | 'working' | 'isQuiet' | 'faces'>): { faces: SessionFace[]; more: number } {
  if (row.state !== 'working' || row.isQuiet || row.faces.length === 0) return { faces: [], more: 0 }
  const faces = row.faces.slice(0, MOST_FACES)
  return { faces, more: Math.max(0, row.working - faces.length) }
}

/** A note at what is answered only in a session's own window (a permission prompt, Claude Code's notification): "Answer it in its window: Terminal · site." (`where` its row's, '' when the list does not hold it). */
export function inItsWindow(lead: string, where: string): string {
  return `${lead} in its window${where !== '' ? `: ${where}` : ''}.`
}

/** The band's words for the other sessions waiting on you: "1 other session needs you"; null when none does. */
export function othersLineOf(view: Pick<SessionsV2, 'others'> | undefined | null): string | null {
  const n = view?.others.waiting ?? 0
  return n > 0 ? `${n} other ${n === 1 ? 'session needs' : 'sessions need'} you` : null
}

/** A page command meant for another session (`session` names it): `view` or one of `STEERING`, the rest as sent; null for any other, and for one naming this session (`me`). */
export function sessionCmdOf(cmd: Record<string, unknown>, me: string): { session: string; cmd: Record<string, unknown> } | null {
  const session = typeof cmd.session === 'string' ? cmd.session : ''
  if (session === '' || session === me || sessionFileOf(session) === '') return null
  const rest = Object.fromEntries(Object.entries(cmd).filter(([key]) => key !== 'session'))
  if (rest.cmd !== 'view' && !STEERING.includes(String(rest.cmd))) return null
  return { session, cmd: rest }
}

/** An inbox file's value (its seal checked and left out, ./seal `openedOf`) read: its view and its commands, each one with an `id` its ack can name (its deck checks the rest: `steeringCmdOf`, refused with an ack); null for anything else. */
export function inboxFrom(value: unknown): InboxFile | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.from !== 'string' || sessionFileOf(value.from) === '' || typeof value.to !== 'string' || sessionFileOf(value.to) === '') return null
  const at = typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0
  const viewUntil = typeof value.viewUntil === 'number' && Number.isFinite(value.viewUntil) ? value.viewUntil : 0
  const pidOf = (pid: unknown) => (typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null)
  const cmds: InboxCommand[] = Array.isArray(value.cmds)
    ? value.cmds.flatMap((one: unknown) => (isRecord(one) && typeof one.at === 'number' && isRecord(one.cmd) && typeof one.cmd.id === 'string' && CMD_ID.test(one.cmd.id) ? [{ at: one.at, cmd: one.cmd, pid: pidOf(one.pid) }] : []))
    : []
  return { v: 1, from: value.from, to: value.to, at, viewUntil, cmds: cmds.slice(-INBOX_MOST) }
}

/** An inbox file's text read as it stands (its seal not checked: `inboxFrom` for one that was); null for anything else. */
export function inboxFromText(text: string): InboxFile | null {
  try {
    return inboxFrom(JSON.parse(text))
  } catch {
    return null
  }
}

/** The inbox file a viewer writes next into session `to`'s inbox: its view until `viewUntil`, and its commands with `add` last, the newest 20, those past `COMMAND_MS` let go. */
export function inboxWith(from: string, to: string, now: number, viewUntil: number, kept: readonly InboxCommand[], add: InboxCommand | null): InboxFile {
  const cmds = [...kept, ...(add ? [add] : [])].filter(one => now - one.at <= COMMAND_MS).slice(-INBOX_MOST)
  return { v: 1, from, to, at: now, viewUntil, cmds }
}

/** A session's `state.json` read: its v2 state's text (under `v2`, as the deck writes it; bare, as the sample is); null for anything else. */
export function stateFileV2Of(text: string): string | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  const v2 = value.v === 2 ? value : isRecord(value.v2) && value.v2.v === 2 ? value.v2 : null
  return v2 ? JSON.stringify(v2) : null
}

/**
 * Another session's state as this deck shows it: its own list of sessions
 * left out (this deck's own is shown), marked `peer` (where its window is,
 * whether its deck takes commands from here, what came of the presses sent
 * to it). Its controls are its own window's: a Stop or Cancel where its own
 * deck's check allows it, its questions answerable through its deck. Where
 * its deck takes nothing from here (`peer.why`), none is offered, each
 * saying why instead. A permission prompt says where it is answered (`peer`).
 */
export function peerStateOf(state: WebStateV2, peer: V2Peer): WebStateV2 {
  const { sessions: _theirs, ...rest } = state as WebStateV2 & { sessions?: unknown }
  if (peer.canSteer) return { ...rest, peer }
  const deaf = (stop: V2Stop): V2Stop => ({ ...stop, can: false, why: peer.why })
  return {
    ...rest,
    peer,
    needs: rest.needs.map(need => ({ ...need, isAnswerable: false })),
    agents: rest.agents.map(row => (row.row === 'agent' && row.stop ? { ...row, stop: deaf(row.stop) } : row)),
    ...(rest.background ? { background: { ...rest.background, rows: rest.background.rows.map(row => (row.stop ? { ...row, stop: deaf(row.stop) } : row)) } } : {}),
  }
}
