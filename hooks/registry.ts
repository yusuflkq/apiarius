/**
 * Every session on this machine, live (./sessions is the pure half): this
 * deck's file in the registry, the others' read, the inbox other decks
 * write into, and another session's deck shown read-only.
 *
 * - **Its own file.** Written within 2 s of a change of what it shows, and
 *   on a heartbeat every 30 s; on `session.end` (but a `/clear` or a resume,
 *   where the process goes on) marked ended, then removed.
 * - **The others'.** Read on the heartbeat, and on every tick while the list
 *   or another session's deck shows, or the web deck is on. A file whose
 *   heartbeat stopped is checked against the system (is its process
 *   there?) and removed once it is not, or long after.
 * - **Its inbox** (`<state folder>/inbox/<viewer>.json`), read on every tick:
 *   while a deck views this session, this one writes its state folder as
 *   for `/deck web` (`isViewed`); a `chat` or an `answer` in it runs as the
 *   page's own would (the host's `steer`), through Claude Code's channels,
 *   its ack in this session's state. Only a session the registry lists may
 *   write one.
 * - **Viewing another** (`openSession`): its `state.json` and lazy files
 *   read from its folder while its deck shows here, read again when they
 *   change; its deck asked to keep writing them (its inbox) every 30 s.
 *   An answer or a message to it goes into its inbox, where its own deck
 *   takes it; a deck that reads no inbox is answered in its own window.
 *
 * The deck's hooks module hands in what it alone holds (`RegistryHost`:
 * its state, and every engine call, since each `$` call lives there) and
 * calls in from its hooks: `startRegistry` at session.start, `noteChanged`
 * when the screen would change, `registryTick` on its tick, `endRegistry`
 * at session.end.
 */
import type { Timer } from 'claude-code'

import * as F from './format'
import * as S from './sessions'
import type { DashActions, DeckModel, DashModel } from './ui/types'
import * as W from './web'

/** What the environment says of where the registry and the session are: each variable as read, undefined where unset or unread. */
export type RegistryEnv = { override?: string | undefined; configDir?: string | undefined; home?: string | undefined; wtSession?: string | undefined; termProgram?: string | undefined }

/** What the deck's hooks module hands the registry: what it holds, and the engine's calls (the clock, the files, node, the session's surfaces and repository). */
export type RegistryHost = {
  /** `AGENT_DECK_SESSIONS`, `CLAUDE_CONFIG_DIR`, the home folder, `WT_SESSION` and `TERM_PROGRAM`, as the environment holds them. */
  env: () => Promise<RegistryEnv>
  now: () => Promise<number>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<readonly { name: string; kind: string; mtimeMs: number }[]>
  stat: (path: string) => Promise<{ mtimeMs: number; size: number }>
  /** Runs node with `args` (no shell); its exit code and what it printed. */
  node: (args: readonly string[]) => Promise<{ exitCode: number; stdout: string }>
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  /** The surfaces the session draws on (`$.session.surfaces()`). */
  surfaces: () => Promise<readonly string[]>
  /** The session's repository's root; null outside one. */
  repoRoot: () => Promise<string | null>
  /** This session's id, as the deck keeps it ('' before it is read). */
  sessionId: () => string
  /** This session's v2 state as the screen stands, its list of sessions left out. */
  stateOf: (now: number) => W.WebStateV2
  /** This session's state folder (`<mod>/.web/<sessionId>`), where its state goes while it is shared. */
  dirOf: () => string
  /** The session's process id, as the deck read it ('' when it could not). */
  pidOf: () => Promise<string>
  /** Runs a command another session's deck sent, as the page's own: a `chat` or an `answer`, acked under its `id`. */
  steer: (cmd: Record<string, unknown>) => void
  /** Whether this deck's state already holds an ack under `id` (a command acted on before a reload). */
  hasAck: (id: string) => boolean
  /** Says what came of a command in this deck's own state. */
  ack: (id: string, status: 'failed' | 'queued', text: string) => void
  /** A press changed what shows: keep it and draw again. */
  changed: () => void
  /** Something read changed what may show: draw again if the screen would change. */
  refresh: (now: number) => void
  /** A deck began to view this session: write its state folder now. */
  share: () => void
  toast: (text: string) => void
}

/** Another session's deck as this deck holds it while it shows. */
type Viewed = {
  id: string
  /** Its state folder, read from (`sample`: the sample's, under the mod). */
  dir: string
  isSample: boolean
  canSteer: boolean
  state: W.WebStateV2 | null
  /** Its state.json's size and time when last read: read again only when they move. */
  stamp: string
  agents: Record<string, W.V2AgentFile>
  patches: Record<string, string>
  messages: Record<string, string>
  gitDiffs: Record<string, string>
  /** Why nothing shows yet; '' once it does. */
  note: string
  /** Its own agent page, file and commit open (this session's stay as they were). */
  page: string
  file: string
  commit: string
  /** Moves on each change of what it shows, for the screen key. */
  version: number
  openedAt: number
  /** When its deck was last asked to keep writing (its inbox). */
  askedAt: number
  isReading: boolean
}

const reg = {
  /** The registry folder; '' while it is off (no home known, as in the tests). */
  dir: '',
  host: null as RegistryHost | null,
  heartbeat: undefined as Timer | undefined,
  writeTimer: undefined as Timer | undefined,
  pid: null as number | null,
  surface: '' as S.SessionSurface,
  terminal: '',
  repo: '',
  /** This deck's own entry as last written, and its key (its times left out). */
  me: null as S.SessionEntry | null,
  meKey: '',
  updatedAt: 0,
  isWriting: false,
  isWriteQueued: false,
  /** The registry's files as last read, by session id (this one's left out), with their times. */
  entries: new Map<string, S.SessionEntry>(),
  stamps: new Map<string, number>(),
  readAt: 0,
  cleanedAt: 0,
  isReading: false,
  /** Moves on each change of the others' entries: for the screen key. */
  gen: 0,
  entriesKey: '',
  /** The list shows over the tab. */
  isOpen: false,
  /** The decks viewing this session, until when, and the tick's time they are judged at. */
  viewers: new Map<string, number>(),
  tickAt: 0,
  inboxSeen: new Map<string, number>(),
  handled: new Set<string>(),
  /** Another session's deck shown here. */
  viewing: null as Viewed | null,
  /** The sessions the web page views, until when (its `view` commands). */
  looks: new Map<string, number>(),
  /** The commands written into each session's inbox, by its id. */
  outbox: new Map<string, S.InboxCommand[]>(),
  /** The sample's sessions (`/deck demo`), as read; null until they are. */
  sample: null as { entries: S.SessionEntry[]; me: string; root: string } | null,
}

/** The registry folder the deck uses; '' while it is off. */
export function registryDir(): string {
  return reg.dir
}

/** The engine's calls, through the host the deck handed in at its start. */
function io(): RegistryHost {
  if (!reg.host) throw new Error('the registry has not started')
  return reg.host
}

/**
 * Starts the registry for this session.start: its folder from the
 * environment (`AGENT_DECK_SESSIONS`, else under `CLAUDE_CONFIG_DIR` or the
 * home folder; off when none is known), what it says of where the session
 * runs, then the heartbeat, this deck's file and a first read of the others'.
 */
export async function startRegistry(host: RegistryHost): Promise<void> {
  reg.heartbeat?.cancel()
  reg.heartbeat = undefined
  reg.host = host
  const env = await host.env()
  reg.dir = S.registryDirOf(env)
  if (reg.dir === '') return
  reg.terminal = S.terminalOf(env)
  await readWhere()
  const pid = await host.pidOf()
  reg.pid = /^\d+$/.test(pid) ? Number(pid) : null
  reg.heartbeat = io().every(S.HEARTBEAT_MS, () => void beat())
  const now = await io().now()
  await writeEntry(now)
  await readRegistry(now)
}

/** Where the session draws (its surfaces, a Desktop attaching after the start included) and its repository's folder name. */
async function readWhere(): Promise<void> {
  try {
    reg.surface = S.surfaceOf(await io().surfaces())
  } catch {
    // the surface stays as it was read last
  }
  try {
    const root = await io().repoRoot()
    reg.repo = root ? F.baseName(root.replace(/[\\/]+$/, '')) : ''
  } catch {
    // the repository stays as it was read last
  }
}

/** The heartbeat: this deck's file written (its heartbeat moved), where it runs read again, the others' read and the stale cleaned. */
async function beat(): Promise<void> {
  if (reg.dir === '') return
  await readWhere()
  const now = await io().now()
  await writeEntry(now)
  await readRegistry(now)
}

/** This deck's entry as its state stands now (its `updatedAt` the last change's). */
function entryNow(now: number): S.SessionEntry | null {
  const host = reg.host
  if (!host || host.sessionId() === '') return null
  const state = host.stateOf(now)
  if (state.session.id === '') return null
  return S.entryOf(state, { surface: reg.surface, terminal: reg.terminal, repo: reg.repo, pid: reg.pid, dir: host.dirOf(), updatedAt: reg.updatedAt || now, heartbeatAt: now })
}

/** What the screen shows may have changed: this deck's file is written within 2 s when what it says changed (`ENTRY_WRITE_MS`). */
export function noteChanged(now: number): void {
  if (reg.dir === '' || reg.writeTimer) return
  const entry = entryNow(now)
  if (!entry || S.entryKeyOf(entry) === reg.meKey) return
  reg.writeTimer = io().after(S.ENTRY_WRITE_MS, () => {
    reg.writeTimer = undefined
    void (async () => writeEntry(await io().now()))()
  })
}

/** Writes this deck's file: what it shows (its `updatedAt` moved when that changed), its heartbeat now. One write at a time. */
async function writeEntry(now: number): Promise<void> {
  const host = reg.host
  if (reg.dir === '' || !host) return
  if (reg.isWriting) {
    reg.isWriteQueued = true
    return
  }
  const entry = entryNow(now)
  if (!entry) return
  const key = S.entryKeyOf(entry)
  if (key !== reg.meKey) {
    reg.meKey = key
    reg.updatedAt = now
  }
  const shown: S.SessionEntry = { ...entry, updatedAt: reg.updatedAt, heartbeatAt: now }
  const path = S.entryPathOf(reg.dir, shown.id)
  if (path === '') return
  reg.isWriting = true
  try {
    await io().write(path, `${JSON.stringify(shown)}\n`)
    reg.me = shown
  } catch {
    // the next change or heartbeat writes it again
  } finally {
    reg.isWriting = false
    if (reg.isWriteQueued) {
      reg.isWriteQueued = false
      void writeEntry(await io().now())
    }
  }
}

/** Reads the others' files (each again only when its time moved); the list's screen key moves when what they say changed. */
async function readRegistry(now: number): Promise<void> {
  const host = reg.host
  if (reg.dir === '' || !host || reg.isReading) return
  reg.isReading = true
  const me = host.sessionId()
  const next = new Map<string, S.SessionEntry>()
  try {
    for (const one of await io().list(reg.dir)) {
      if (one.kind !== 'file' || !one.name.endsWith('.json')) continue
      const id = one.name.slice(0, -'.json'.length)
      if (S.sessionFileOf(id) === '' || id === me) continue
      const known = reg.entries.get(id)
      if (known && reg.stamps.get(id) === one.mtimeMs) {
        next.set(id, known)
        continue
      }
      try {
        const entry = S.entryFromText(await io().read(`${reg.dir}/${one.name}`))
        if (entry && entry.id === id) {
          next.set(id, entry)
          reg.stamps.set(id, one.mtimeMs)
        }
      } catch {
        // half written, or gone since: the next read sees it
      }
    }
  } catch {
    // no folder yet: no other session
  } finally {
    reg.isReading = false
  }
  reg.entries = next
  reg.readAt = now
  const key = [...next.values()].map(entry => `${entry.id}:${S.isLiveEntry(entry, now)}:${S.entryKeyOf(entry)}:${entry.updatedAt}`).join('\n')
  if (key !== reg.entriesKey) {
    reg.entriesKey = key
    reg.gen += 1
    host.refresh(now)
  }
  if (now - reg.cleanedAt >= S.HEARTBEAT_MS) {
    reg.cleanedAt = now
    void clean(now)
  }
}

/** The processes among `pids` the system still runs (one node call); null when node cannot say. */
async function alivePids(pids: readonly number[]): Promise<Set<number> | null> {
  const script = 'for (const p of process.argv.slice(1)) { try { process.kill(Number(p), 0); console.log(p) } catch (e) { if (e.code === "EPERM") console.log(p) } }'
  try {
    const ran = await io().node(['-e', script, ...pids.map(String)])
    if (ran.exitCode !== 0) return null
    return new Set(ran.stdout.split(/\s+/).filter(one => /^\d+$/.test(one)).map(Number))
  } catch {
    return null
  }
}

/** Removes files the deck made (its registry's, its inbox's), by their paths (one node call: the engine's files write but never remove). */
async function removeFiles(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return
  const script = 'for (const p of process.argv.slice(1)) { try { require("fs").rmSync(p, { force: true }) } catch {} }'
  try {
    await io().node(['-e', script, ...paths])
  } catch {
    // left for the next deck's clean
  }
}

/** Cleans the registry: the files of sessions that ended, or whose heartbeat stopped and whose process is gone (or long silent). */
async function clean(now: number): Promise<void> {
  const gone: string[] = []
  const check: S.SessionEntry[] = []
  for (const entry of reg.entries.values()) {
    const step = S.staleStepOf(entry, now)
    if (step === 'gone') gone.push(entry.id)
    else if (step === 'check') check.push(entry)
  }
  if (check.length > 0) {
    const alive = await alivePids(check.flatMap(entry => (entry.pid === null ? [] : [entry.pid])))
    if (alive) for (const entry of check) if (S.staleStepOf(entry, now, alive.has(entry.pid ?? 0)) === 'gone') gone.push(entry.id)
  }
  const paths = gone.map(id => S.entryPathOf(reg.dir, id)).filter(path => path !== '')
  await removeFiles(paths)
}

/**
 * `session.end`: this deck's file marked ended (a deck reading it then
 * leaves it out), then removed; the session it views told it looks no more.
 * A `/clear` or a resume keeps it: the process goes on.
 */
export async function endRegistry(reason: string): Promise<void> {
  if (reg.dir === '' || reason === 'clear' || reason === 'resume') return
  reg.heartbeat?.cancel()
  reg.heartbeat = undefined
  reg.writeTimer?.cancel()
  reg.writeTimer = undefined
  const me = reg.me
  const path = me ? S.entryPathOf(reg.dir, me.id) : ''
  if (me && path !== '') {
    try {
      await io().write(path, `${JSON.stringify({ ...me, endedAt: await io().now() })}\n`)
    } catch {
      // another deck's clean finds it silent
    }
  }
  const viewed = reg.viewing
  reg.viewing = null
  if (viewed && !viewed.isSample) await askView(viewed.id, viewed.dir, 0)
  if (path !== '') await removeFiles([path])
}

/** Whether a deck views this session at `now`: it writes its state folder meanwhile, as for `/deck web`. */
export function isViewed(now: number): boolean {
  for (const until of reg.viewers.values()) if (until > now) return true
  return false
}

/** Whether this session's state folder is to be written for a deck viewing it, as of the last tick. */
export function isShared(): boolean {
  return isViewed(reg.tickAt)
}

/**
 * Reads this session's inbox: each viewer's file whose time moved, from a
 * session the registry lists. Its view keeps this session's state folder
 * written (`share` when a first one comes); each `chat` or `answer` not
 * acted on yet, given within `COMMAND_MS`, runs as the page's own would
 * (`steer`). An inbox file long silent is removed.
 */
async function pollInbox(now: number): Promise<void> {
  const host = reg.host
  if (reg.dir === '' || !host) return
  const dir = host.dirOf()
  if (dir === '') return
  let listed: Awaited<ReturnType<RegistryHost['list']>>
  try {
    listed = await io().list(`${dir}/inbox`)
  } catch {
    return
  }
  const wasViewed = isViewed(now)
  const silent: string[] = []
  for (const one of listed) {
    if (one.kind !== 'file' || !one.name.endsWith('.json')) continue
    if (now - one.mtimeMs > S.GONE_MS) silent.push(`${dir}/inbox/${one.name}`)
    if (reg.inboxSeen.get(one.name) === one.mtimeMs) continue
    let file: S.InboxFile | null = null
    try {
      file = S.inboxFromText(await io().read(`${dir}/inbox/${one.name}`))
    } catch {
      continue
    }
    reg.inboxSeen.set(one.name, one.mtimeMs)
    if (!file || `${file.from}.json` !== one.name || !(await isListed(file.from, now))) continue
    reg.viewers.set(file.from, Math.min(file.viewUntil, now + S.VIEW_MS))
    for (const said of file.cmds) {
      const id = typeof said.cmd.id === 'string' ? said.cmd.id : ''
      if (id === '' || reg.handled.has(id) || now - said.at > S.COMMAND_MS || host.hasAck(id)) continue
      reg.handled.add(id)
      if (reg.handled.size > 500) reg.handled.delete(reg.handled.values().next().value as string)
      host.steer(said.cmd)
    }
  }
  if (!wasViewed && isViewed(now)) host.share()
  await removeFiles(silent)
}

/** Whether `id` is a live session the registry lists: read afresh when this deck has not seen it yet. */
async function isListed(id: string, now: number): Promise<boolean> {
  const known = reg.entries.get(id)
  if (known && S.isLiveEntry(known, now)) return true
  const path = S.entryPathOf(reg.dir, id)
  if (path === '') return false
  try {
    const entry = S.entryFromText(await io().read(path))
    return entry !== null && entry.id === id && S.isLiveEntry(entry, now)
  } catch {
    return false
  }
}

/**
 * The deck's tick: this session's inbox read; while the list, another
 * session's deck or the web page shows (`isWebOn`), the others' files read
 * again, and the session viewed read again where it changed.
 */
export async function registryTick(now: number, isWebOn: boolean): Promise<void> {
  if (reg.dir === '') return
  reg.tickAt = now
  try {
    await pollInbox(now)
    if (reg.isOpen || reg.viewing !== null || isWebOn) await readRegistry(now)
    for (const [id, until] of reg.looks) if (until <= now) reg.looks.delete(id)
    if (reg.viewing) await readViewed(now)
  } catch {
    // the deck's own tick goes on: the next one reads again
  }
}

// ---------------------------------------------------------------- the list

/** What the screens draw of the sessions: the list, this deck's own row first (made from `state` now), its ages worded at `now`; the sample's with `state` null; null while the registry is off or no sample is read. */
export function sessionsFor(state: W.WebStateV2 | null, now: number): S.SessionsV2 | null {
  if (state === null) {
    const sample = reg.sample
    if (!sample) return null
    return S.sessionsViewOf(
      sample.entries.filter(entry => entry.id !== sample.me),
      sample.entries.find(entry => entry.id === sample.me) ?? null,
      now,
    )
  }
  if (reg.dir === '' || state.session.id === '') return null
  const me = S.entryOf(state, { surface: reg.surface, terminal: reg.terminal, repo: reg.repo, pid: reg.pid, dir: reg.host?.dirOf() ?? '', updatedAt: reg.updatedAt || now, heartbeatAt: now })
  return S.sessionsViewOf([...reg.entries.values()], me, now)
}

/** What the others' files say, as one key: it moves when the list's rows may change (this deck's own row aside). */
export function listKey(): string {
  return `${reg.gen}|${reg.sample !== null}`
}

/** What the list and the session viewed show, as one key: equal keys draw the same. */
export function registryKey(): string {
  const v = reg.viewing
  return [reg.gen, reg.isOpen, v ? `${v.id}:${v.version}:${v.page}:${v.file}:${v.commit}` : '', reg.sample !== null].join('|')
}

/** The list shows over the tab. */
export function isListOpen(): boolean {
  return reg.isOpen
}

/** `s`: the list opened over the tab (read afresh), or closed when it shows. */
export function toggleList(): void {
  reg.isOpen = !reg.isOpen
  reg.host?.changed()
  if (reg.isOpen && reg.host && reg.dir !== '') void (async () => readRegistry(await io().now()))().catch(() => undefined)
}

/** The list closed, for the tab (or the session viewed) it was opened over. */
export function closeList(): void {
  if (!reg.isOpen) return
  reg.isOpen = false
  reg.host?.changed()
}

/** The sample's sessions (`/deck demo`): `web/fixtures/sessions.v2.json` under the mod, their times moved to now; their decks under `web/fixtures/sessions/`. */
export async function readSample(root: string, now: number): Promise<void> {
  try {
    const value = JSON.parse(await io().read(`${root}/web/fixtures/sessions.v2.json`)) as { now?: unknown; me?: unknown; entries?: unknown }
    const by = typeof value.now === 'number' ? now - value.now : 0
    const entries = (Array.isArray(value.entries) ? value.entries : []).flatMap(one => {
      const entry = S.entryFromText(JSON.stringify(one))
      return entry ? [{ ...entry, startedAt: entry.startedAt + by, updatedAt: entry.updatedAt + by, heartbeatAt: now }] : []
    })
    reg.sample = { entries, me: typeof value.me === 'string' ? value.me : '', root }
  } catch {
    reg.sample = null
  }
  reg.host?.changed()
}

/** The sample's sessions let go, with the session viewed in it. */
export function leaveSample(): void {
  reg.sample = null
  if (reg.viewing?.isSample) reg.viewing = null
}

// ------------------------------------------------- another session's deck

/**
 * Opens session `id`'s deck read-only: from its state folder (the sample's
 * from the mod's fixtures), its deck asked through its inbox to write it
 * while it shows. The list closes.
 */
export async function openSession(id: string, isSample = false): Promise<void> {
  const host = reg.host
  if (!host) return
  const now = await io().now()
  const sample = isSample ? reg.sample : null
  const entry = sample ? sample.entries.find(one => one.id === id) : reg.entries.get(id)
  if (!entry || entry.dir === '') {
    host.toast('Its deck names no folder to read: open it in its window.')
    return
  }
  const dir = sample ? `${sample.root}/web/fixtures/${entry.dir}` : entry.dir
  if (!sample && !S.isStateDirOf(dir, id)) {
    host.toast('Its deck names a folder Agent Deck does not read: open it in its window.')
    return
  }
  const viewed = reg.viewing
  if (viewed && !viewed.isSample && viewed.id !== id) void askView(viewed.id, viewed.dir, reg.looks.get(viewed.id) ?? 0)
  reg.viewing = {
    id,
    dir,
    isSample: sample !== null,
    canSteer: entry.inbox,
    state: null,
    stamp: '',
    agents: {},
    patches: {},
    messages: {},
    gitDiffs: {},
    note: 'Reading its deck…',
    page: '',
    file: '',
    commit: '',
    version: 0,
    openedAt: now,
    askedAt: now,
    isReading: false,
  }
  reg.isOpen = false
  host.changed()
  if (!sample) await askView(id, dir, now + S.VIEW_MS)
  await readViewed(now)
}

/** Back to this chat: off the session viewed (its deck told this one looks no more) and the list. */
export function backToThisChat(): void {
  const viewed = reg.viewing
  reg.viewing = null
  reg.isOpen = false
  if (viewed && !viewed.isSample) void askView(viewed.id, viewed.dir, reg.looks.get(viewed.id) ?? 0)
  reg.host?.changed()
}

/** Writes this deck's file in session `id`'s inbox: looking until `until` (0: no more), with the commands it sent there. */
async function askView(id: string, dir: string, until: number): Promise<void> {
  const me = reg.host?.sessionId() ?? ''
  const path = S.inboxPathOf(dir, me)
  if (path === '' || !S.isStateDirOf(dir, id)) return
  const now = await io().now()
  const file = S.inboxWith(me, now, Math.max(until, reg.looks.get(id) ?? 0, reg.viewing?.id === id ? now + S.VIEW_MS : 0), reg.outbox.get(id) ?? [], null)
  reg.outbox.set(id, file.cmds)
  try {
    await io().write(path, `${JSON.stringify(file)}\n`)
  } catch {
    // its deck reads none: the viewer says so once nothing comes
  }
}

/** Reads the session viewed again where its state.json moved (its lazy files with it), and asks its deck again every 30 s. */
async function readViewed(now: number): Promise<void> {
  const v = reg.viewing
  if (!v || v.isReading) return
  v.isReading = true
  try {
    if (!v.isSample && now - v.askedAt >= S.VIEW_AGAIN_MS) {
      v.askedAt = now
      await askView(v.id, v.dir, now + S.VIEW_MS)
    }
    let stamp = ''
    try {
      const stat = await io().stat(`${v.dir}/state.json`)
      stamp = `${stat.mtimeMs}:${stat.size}`
    } catch {
      stamp = ''
    }
    if (stamp === '') {
      const note = now - v.openedAt > 15_000 ? 'Its deck has not written its state: answer it in its window.' : 'Asking its deck for its state…'
      if (note !== v.note && v.state === null) {
        v.note = note
        v.version += 1
        reg.host?.refresh(now)
      }
      return
    }
    if (stamp === v.stamp) return
    const text = S.stateFileV2Of(await io().read(`${v.dir}/state.json`))
    const built = text === null ? null : (JSON.parse(text) as { now?: unknown }).now
    const at = typeof built === 'number' ? built : now
    // the sample's times move to now, as `/deck demo`'s own; a live state's stay as its deck wrote them
    const state = text === null ? null : W.v2StateFromText(text, v.isSample ? now : at)
    if (!state || reg.viewing !== v) return
    v.stamp = stamp
    await readLazy(v, state, v.isSample ? now - at : 0)
    v.state = S.viewedStateOf(state, v.canSteer && !v.isSample)
    v.note = ''
    v.version += 1
    reg.host?.refresh(now)
  } catch {
    // half written: the next tick reads it again
  } finally {
    v.isReading = false
  }
}

/** The lazy files `state` names in the folder viewed: each agent's file again (they change), each patch, cut message and git diff once. */
async function readLazy(v: Viewed, state: W.WebStateV2, by: number): Promise<void> {
  const isSafe = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id)
  const read = async (path: string, keep: (text: string) => void) => {
    try {
      keep((await io().read(path)).replace(/\r\n/g, '\n'))
    } catch {
      // not written (yet): its screen says so
    }
  }
  const agents: Record<string, W.V2AgentFile> = {}
  await Promise.all([
    ...state.agents.flatMap(row =>
      row.row === 'agent' && isSafe(row.fileId)
        ? [
            read(`${v.dir}/agents/${row.fileId}.json`, text => {
              agents[row.fileId] = W.v2TimesMoved(JSON.parse(text) as W.V2AgentFile, by)
            }),
          ]
        : [],
    ),
    ...state.changes.edits.filter(edit => isSafe(edit.id) && !Object.hasOwn(v.patches, edit.id)).map(edit => read(`${v.dir}/patches/${edit.id}.diff`, text => (v.patches[edit.id] = text))),
    ...state.chat.filter(row => row.isCut && isSafe(row.id) && !Object.hasOwn(v.messages, row.id)).map(row => read(`${v.dir}/messages/${row.id}.md`, text => (v.messages[row.id] = text.trimEnd()))),
    ...state.changes.files.flatMap(file => (file.diffId !== null && isSafe(file.diffId) && !Object.hasOwn(v.gitDiffs, file.diffId) ? [file.diffId] : [])).map(id => read(`${v.dir}/gitdiffs/${id}.diff`, text => (v.gitDiffs[id] = text))),
  ])
  v.agents = agents
}

/**
 * The session viewed, as the pane draws it in place of this one's: its bar,
 * its state, its lazy files, its model (its own page, file and commit; no
 * git of this session's, no web line, no band) and its presses (its agent
 * page; an answer or a message to its deck; nothing else of this deck's).
 * Null while none is viewed, or the list shows over it.
 */
export function viewingFor(model: DeckModel, actions: DashActions): DashModel['viewing'] {
  const v = reg.viewing
  if (!v || reg.isOpen) return null
  const list = v.isSample ? sessionsFor(null, model.now) : reg.host ? sessionsFor(reg.host.stateOf(model.now), model.now) : null
  const row = list?.rows.find(one => one.id === v.id) ?? null
  const changed = () => {
    v.version += 1
    reg.host?.changed()
  }
  const refuse = (what: string) => reg.host?.toast(`${what}: this is another session's deck, shown read-only. Do it in its window.`)
  const viewedActions: DashActions = {
    ...actions,
    openAgent: id => {
      v.page = id
      changed()
    },
    back: () => {
      v.page = ''
      changed()
    },
    selectFile: path => {
      v.file = v.file === path ? '' : path
      changed()
    },
    selectCommit: hash => {
      v.commit = v.commit === hash ? '' : hash
      changed()
    },
    answer: (callId, answers) => void steerViewed(v, { cmd: 'answer', callId, answers }),
    sendChat: (agentId, text) => void steerViewed(v, { cmd: 'chat', agentId, text }),
    review: () => refuse('Review'),
    clearFinished: () => refuse('Clear finished'),
    showCleared: () => refuse('Show cleared'),
    loadMessage: (id, onRead) => onRead(Object.hasOwn(v.messages, id) ? (v.messages[id] ?? null) : null),
  }
  return {
    bar: { id: v.id, row, canSteer: v.canSteer && !v.isSample, note: v.state ? (v.isSample ? 'Sample data: a recorded session. Nothing here reaches Claude.' : '') : v.note },
    state: v.state,
    files: W.v2FilesFrom({ agents: v.agents, patches: v.patches, messages: v.messages, gitDiffs: v.gitDiffs }),
    model: { ...model, view: { ...model.view, page: v.page, file: v.file, commit: v.commit }, fileDiff: null, commit: null, band: null, isSessionsOpen: false },
    actions: viewedActions,
  }
}

/** An answer or a message from the pane to the session viewed: into its inbox, where its own deck takes it; refused where its deck reads none, or in the sample. */
async function steerViewed(v: Viewed, cmd: Record<string, unknown>): Promise<void> {
  if (v.isSample) {
    reg.host?.toast('Sample data: nothing is sent.')
    return
  }
  const id = `deck-${(await io().now()).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const why = await sendToSession(v.id, { ...cmd, id })
  reg.host?.toast(why === '' ? 'Sent to its deck, which passes it to Claude Code: what came of it shows there.' : why)
}

/**
 * A page command for another session (`S.sessionCmdOf`): `view` keeps it
 * written while the page looks (asked again with each one); a `chat` or an
 * `answer` goes into its inbox, its ack then in its own state. Answers why
 * it could not go ('' when it went), and acks that here too.
 */
export async function fromPage(session: string, cmd: Record<string, unknown>): Promise<string> {
  if (!reg.host || reg.dir === '') return 'No other session is known here'
  const now = await io().now()
  if (cmd.cmd === 'view') {
    const entry = reg.entries.get(session)
    if (!entry || !S.isStateDirOf(entry.dir, session)) return 'No such session'
    reg.looks.set(session, now + S.VIEW_MS)
    await askView(session, entry.dir, now + S.VIEW_MS)
    return ''
  }
  return sendToSession(session, cmd)
}

/** Writes a `chat` or an `answer` (with its `id`) into session `id`'s inbox; answers why not ('' when it went), acked here when it could not go. */
async function sendToSession(id: string, cmd: Record<string, unknown>): Promise<string> {
  const host = reg.host
  const ackId = W.cmdIdOf(cmd)
  const entry = reg.entries.get(id)
  const me = host?.sessionId() ?? ''
  const now = await io().now()
  const fail = (why: string) => {
    host?.ack(ackId, 'failed', why)
    return why
  }
  if (!host || !entry || !S.isLiveEntry(entry, now)) return fail('That session is not running any more')
  if (!entry.inbox || !S.isStateDirOf(entry.dir, id)) return fail('Answer it in its window: its deck takes no answers or messages from another')
  if (!S.STEERING.includes(String(cmd.cmd)) || ackId === '') return fail('Only an answer or a message goes to another session')
  const path = S.inboxPathOf(entry.dir, me)
  if (path === '') return fail('Answer it in its window')
  const file = S.inboxWith(me, now, Math.max(reg.looks.get(id) ?? 0, reg.viewing?.id === id ? now + S.VIEW_MS : 0), reg.outbox.get(id) ?? [], cmd)
  reg.outbox.set(id, file.cmds)
  try {
    await io().write(path, `${JSON.stringify(file)}\n`)
  } catch {
    return fail('Could not reach its deck: answer it in its window')
  }
  return ''
}
