/**
 * Every session on this machine (web/CONTRACT.md, "All sessions"): each
 * session's deck keeps a small file in a folder of the person's own, and
 * every deck reads the others' to list them.
 *
 * - **The registry.** `<registry>/<sessionId>.json` (`SessionEntry`), where
 *   the registry is `~/.claude/agent-deck/sessions` (`registryDirOf`). A deck
 *   writes its own when what it shows changes (at most every 2 s) and on a
 *   heartbeat (every 30 s), and lets it go on `session.end`. A file whose
 *   heartbeat stopped is no session's any more: left out at once, and cleaned
 *   once its process is gone (or long after).
 * - **The list** (`SessionsV2`, the v2 state's `sessions`): each session's
 *   state in a word, its title, where it runs, what it waits on you for or
 *   what it is doing, its spend (/cost's estimate at API list prices, a
 *   fork's counting its parent's) and how long since it changed. This chat
 *   first, then the others, the newest started first, so rows stay put.
 * - **Opening one.** A session's deck shows from its state folder (the
 *   `state.json` and lazy files `/deck web` writes). A deck writes them only
 *   while it is asked to: another deck viewing it says so in its inbox
 *   (`InboxFile.viewUntil`), as long as it looks.
 * - **Steering one.** Answering its question or messaging it goes to its own
 *   deck, which acts through Claude Code's channels as for its own page: the
 *   viewer writes the command into `<dir>/inbox/<its own id>.json`, the
 *   session's deck reads it on its tick, and its ack shows in its state.
 *   Nothing else is taken from an inbox, and a deck that reads none
 *   (`inbox: false`, an older build) is answered in its own window.
 *
 * Pure: the hooks module does the reading, writing and timing.
 */
import * as F from './format'
import type { V2AgentRow, V2Need, WebStateV2 } from './web'

/** The registry file's version. */
export const REGISTRY_V = 1
/** How often a deck says it lives, though nothing changed. */
export const HEARTBEAT_MS = 30_000
/** At most this often a change of what a session shows is written. */
export const ENTRY_WRITE_MS = 2_000
/** No heartbeat for this long: the session is gone, or hung; it is left out of the list. */
export const STALE_MS = 3 * 60_000
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

/** One session's file in the registry, `<registry>/<sessionId>.json`, as its deck writes it. */
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
  /** Its state folder (`<mod>/.web/<sessionId>`): `state.json`, its lazy files and its inbox. */
  dir: string
  /** Its deck reads view requests and commands from its inbox. */
  inbox: boolean
  /** Set by `session.end` before the file goes: it ended. */
  endedAt?: number
}

/** One row of the list: a session as every surface shows it. */
export type SessionRowV2 = {
  id: string
  /** This chat: the session whose deck draws the list. */
  isMe: boolean
  /** Its title, else "No request yet". */
  title: string
  state: SessionEntry['state']
  /** "Working", "Waiting on you", "Idle". */
  stateText: string
  surface: SessionSurface
  /** Where it runs, in words: "Desktop", "Terminal · Windows Terminal", "VS Code"; '' when no surface is attached. */
  place: string
  /** Its repository's name, else its folder's. */
  repo: string
  cwd: string
  /** The first thing that needs you there, in a line; null when nothing does. */
  need: string | null
  /** What the row says under its title: the need, else what it is doing (derived from its calls), else ''. */
  say: string
  working: number
  costUsd: number | null
  /** "≈$4.12", whole dollars from $100 ("≈$491"); '' while unknown. */
  cost: string
  /** Under it, for a fork's: "incl. its parent's" (its spend began at the session it was forked from); '' for any other, and while the spend is unknown. */
  costNote: string
  /** When what it shows last changed, and how long ago: "now", "3m", "2h". */
  at: number
  age: string
  startedAt: number
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
}

/** The view and the steering a viewer writes into a session's inbox, `<dir>/inbox/<viewer's id>.json`, whole each time. */
export type InboxFile = {
  v: 1
  /** The viewer's session id. */
  from: string
  /** When it was written. */
  at: number
  /** Until when the viewer looks: the session writes its state folder till then; 0 when it looks no more. */
  viewUntil: number
  /** Its commands, oldest first, the newest 20: `chat` or `answer`, each with its own `id` (its ack's). */
  cmds: InboxCommand[]
}

/** One command in an inbox: a page command (`chat`, `answer`) as the page sends it, with its `id`, and when it was given. */
export type InboxCommand = { at: number; cmd: Record<string, unknown> }

const STATE_TEXT: Readonly<Record<SessionEntry['state'], string>> = { working: 'Working', waiting: 'Waiting on you', idle: 'Idle' }

const SURFACE_WORD: Readonly<Record<Exclude<SessionSurface, ''>, string>> = { desktop: 'Desktop', terminal: 'Terminal', vscode: 'VS Code', mobile: 'Mobile' }

/** The commands a deck takes from another session's deck: what its page's answer and composer send. */
export const STEERING: readonly string[] = ['chat', 'answer']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A session id as a file name: `[A-Za-z0-9_-]`, 1 to 100 characters; '' for anything else. */
export function sessionFileOf(id: string): string {
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : ''
}

/**
 * The registry folder: `AGENT_DECK_SESSIONS` when set (the tests', and a
 * person's own choice), else `agent-deck/sessions` under Claude Code's
 * configuration folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`); '' when no
 * home is known.
 */
export function registryDirOf(env: { override?: string | undefined; configDir?: string | undefined; home?: string | undefined }): string {
  const trim = (path: string) => path.replace(/[\\/]+$/, '')
  if (env.override && env.override.trim() !== '') return trim(env.override.trim())
  if (env.configDir && env.configDir.trim() !== '') return `${trim(env.configDir.trim())}/agent-deck/sessions`
  if (env.home && env.home.trim() !== '') return `${trim(env.home.trim())}/.claude/agent-deck/sessions`
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

/** Whether `dir` is a session's state folder as the deck makes them, `…/.web/<id>`: the only folders a viewer reads or writes. */
export function isStateDirOf(dir: string, id: string): boolean {
  const parts = dir.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts.length >= 3 && parts[parts.length - 1] === sessionFileOf(id) && parts[parts.length - 2] === '.web' && !parts.includes('..')
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
    working: state.agents.filter((row): row is V2AgentRow => row.row === 'agent' && isWorkingAgent(row)).length,
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

/** A registry file read: the entry, every field checked; null for anything else (a half-written file, another program's). */
export function entryFromText(text: string): SessionEntry | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
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
 * chat's own (`me`, always shown, though its file is not read back yet):
 * this chat first, then the others, the newest started first, so rows keep
 * their places while their sessions work.
 */
export function sessionsViewOf(entries: readonly SessionEntry[], me: SessionEntry | null, now: number): SessionsV2 {
  const live = entries.filter(entry => isLiveEntry(entry, now) && entry.id !== me?.id)
  const others = [...live].sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
  const rows = [...(me ? [rowOf(me, true, now)] : []), ...others.map(entry => rowOf(entry, false, now))]
  const waiting = rows.filter(row => row.state === 'waiting').length
  const working = rows.filter(row => row.state === 'working').length
  const text = [`${rows.length} on this machine`, waiting > 0 ? `${waiting} waiting on you` : '', working > 0 ? `${working} working` : ''].filter(part => part !== '').join(' · ')
  const otherRows = rows.filter(row => !row.isMe)
  return { rows, text, others: { waiting: otherRows.filter(row => row.state === 'waiting').length, working: otherRows.filter(row => row.state === 'working').length } }
}

function rowOf(entry: SessionEntry, isMe: boolean, now: number): SessionRowV2 {
  const canOpen = entry.dir !== ''
  return {
    id: entry.id,
    isMe,
    title: entry.title !== '' ? entry.title : 'No request yet',
    state: entry.state,
    stateText: STATE_TEXT[entry.state],
    surface: entry.surface,
    place: placeOf(entry.surface, entry.terminal),
    repo: entry.repo !== '' ? entry.repo : folderOf(entry.cwd),
    cwd: entry.cwd,
    need: entry.need,
    say: entry.need ?? entry.live,
    working: entry.working,
    costUsd: entry.costUsd,
    cost: costOf(entry.costUsd),
    costNote: entry.isFork === true && entry.costUsd !== null ? 'incl. its parent’s' : '',
    at: entry.updatedAt,
    age: entry.updatedAt > 0 ? F.since(now - entry.updatedAt) : '',
    startedAt: entry.startedAt,
    canOpen,
    canSteer: canOpen && entry.inbox,
  }
}

/** The list's ages worded again at `now` (the pane builds its screens anew; the rows' `at` stays). */
export function sessionsAgedOf(view: SessionsV2, now: number): SessionsV2 {
  return { ...view, rows: view.rows.map(row => ({ ...row, age: row.at > 0 ? F.since(now - row.at) : '' })) }
}

/** The band's words for the other sessions waiting on you: "1 other session needs you"; null when none does. */
export function othersLineOf(view: Pick<SessionsV2, 'others'> | undefined | null): string | null {
  const n = view?.others.waiting ?? 0
  return n > 0 ? `${n} other ${n === 1 ? 'session needs' : 'sessions need'} you` : null
}

/** A page command meant for another session (`session` names it): `view`, `chat` or `answer`, the rest as sent; null for any other, and for one naming this session (`me`). */
export function sessionCmdOf(cmd: Record<string, unknown>, me: string): { session: string; cmd: Record<string, unknown> } | null {
  const session = typeof cmd.session === 'string' ? cmd.session : ''
  if (session === '' || session === me || sessionFileOf(session) === '') return null
  const rest = Object.fromEntries(Object.entries(cmd).filter(([key]) => key !== 'session'))
  if (rest.cmd !== 'view' && !STEERING.includes(String(rest.cmd))) return null
  return { session, cmd: rest }
}

/** An inbox file read: its view and its commands (`chat` and `answer` with an `id` alone), each checked; null for anything else. */
export function inboxFromText(text: string): InboxFile | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || value.v !== 1 || typeof value.from !== 'string' || sessionFileOf(value.from) === '') return null
  const at = typeof value.at === 'number' ? value.at : 0
  const viewUntil = typeof value.viewUntil === 'number' ? value.viewUntil : 0
  const cmds: InboxCommand[] = Array.isArray(value.cmds)
    ? value.cmds.flatMap((one: unknown) => (isRecord(one) && typeof one.at === 'number' && isRecord(one.cmd) && STEERING.includes(String(one.cmd.cmd)) && typeof one.cmd.id === 'string' ? [{ at: one.at, cmd: one.cmd }] : []))
    : []
  return { v: 1, from: value.from, at, viewUntil, cmds: cmds.slice(-INBOX_MOST) }
}

/** The inbox file a viewer writes next: its view until `viewUntil`, and its commands with `add` last, the newest 20, those past `COMMAND_MS` let go. */
export function inboxWith(from: string, now: number, viewUntil: number, kept: readonly InboxCommand[], add: Record<string, unknown> | null): InboxFile {
  const cmds = [...kept, ...(add ? [{ at: now, cmd: add }] : [])].filter(one => now - one.at <= COMMAND_MS).slice(-INBOX_MOST)
  return { v: 1, from, at: now, viewUntil, cmds }
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
 * Another session's state as this deck shows it, read-only: its questions
 * answerable only where its deck takes answers from here (`canSteer`), and
 * its own list of sessions left out (this deck's own is shown).
 */
export function viewedStateOf(state: WebStateV2, canSteer: boolean): WebStateV2 {
  const { sessions: _theirs, ...rest } = state as WebStateV2 & { sessions?: unknown }
  return { ...rest, needs: canSteer ? rest.needs : rest.needs.map(need => ({ ...need, isAnswerable: false })) }
}
