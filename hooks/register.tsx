/**
 * Agent Deck: a pane (`/deck`) that shows the session's git state and every
 * agent's work, and a band above the prompt while subagents run.
 *
 * The hooks here record what the engine reports (tool calls, spawns, turns,
 * messages between agents) into one live model, run git in the background,
 * and draw the views from `./views`. Every `$` call lives in this file.
 */
import type { AgentInfo, EngineInterface, Register, RenderElement, SessionMessage, Timer, ToolCallResult } from 'claude-code'

import type { DeckAgent, DeckData, DeckStatus, DeckView } from '../types'
import { addedFileHunks, countOf, hunksOf, patchOf, replaceHunks, type Hunk } from './diff'
import * as F from './format'
import * as G from './git'
import * as M from './model'
import * as R from './repos'
import { bandView } from './ui/band'
import type { Actions, ChatLine, DayRow, DeckModel, Kit, UsageInfo } from './ui/types'
import { deckView } from './views'

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
const timers: { git?: Timer; save?: Timer; tick?: Timer; day?: Timer } = {}
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
 * Everything on screen that can change with no event to redraw it (time
 * passing, the background reads): each agent's status, now text and coarse
 * elapsed time while it runs, the banner, git (whether read, HEAD, branch,
 * files and counts), the usage figures rounded, the day history, and on a
 * tab with a per-minute chart the minute. Equal keys draw the same screen.
 */
function screenKey(now: number): string {
  const figures = usage
    ? [Math.round(usage.contextPercent ?? -1), F.money(usage.costUsd), ...usage.limits.map(limit => `${limit.kind}:${Math.round(limit.percentUsed)}`)].join(' ')
    : ''
  const minute = isPaneOpen && view.tab === 'stats' ? M.minuteOf(now) : ''
  return [M.agentsKeyOf(data, git, now), gitKeyOf(git), figures, JSON.stringify(days), minute].join('\n\u0001')
}

/** Redraws only when the screen would change: how the timer and the background reads draw, so nothing moves while nothing changes. */
function redrawIfChanged($: EngineInterface, now: number) {
  const key = screenKey(now)
  if (key === shownKey) return
  shownKey = key
  redraw($)
}

/** Keeps the model in `$.state`, so a reload of this module picks it up again. */
function save($: EngineInterface) {
  if (timers.save) return
  timers.save = $.clock.after(1500, () => {
    timers.save = undefined
    void $.state.set(SNAPSHOT, M.copyOf({ v: M.SNAPSHOT_VERSION, data, view })).catch(() => undefined)
  })
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
    if (M.isEnded(agent.status)) {
      agent.status = 'running'
      agent.endedAt = undefined
    }
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
    const agent = M.ensureAgent(data, info.id, now)
    if (!isKnown) isChanged = true
    if (info.teammateId) agent.kind = 'teammate'
    if (info.description && !agent.description) agent.description = info.description
    if (info.type && (agent.type === 'subagent' || agent.type === '')) agent.type = info.type
    if (info.name && agent.name.startsWith('agent-')) agent.name = info.name
    if (info.parentId && (agent.parentId === undefined || agent.parentId === M.MAIN) && M.agentOf(data, info.parentId)) agent.parentId = info.parentId
    const status = info.status as DeckStatus
    if (agent.status !== status) {
      agent.status = status
      if (M.isEnded(status)) {
        agent.endedAt ??= now
        agent.current = undefined
        delete agent.todo
      }
      isChanged = true
    }
  }

  if (isChanged) {
    save($)
    redraw($)
  }
}

/**
 * Every 2.5 seconds: folds in the agents' statuses and, while the pane is
 * open, re-reads git, usage and history in the background. It draws only
 * when the screen would change (`redrawIfChanged`); events draw for themselves.
 */
async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const isAnyLive = data.agents.some(agent => (agent.kind === 'agent' || agent.kind === 'teammate') && M.isLive(agent.status))
  if (isAnyLive || isPaneOpen) await syncAgents($)
  if (isPaneOpen) {
    if (now - lastGitAt > 6000) void refreshGit($)
    if (now - usageAt > 10_000) void loadUsage($)
    if (now - daysAt > 120_000) void loadDays($)
    if (view.tab === 'agents' && view.agentPane === 'chat' && now - (chat?.at ?? 0) > 6000) void loadChat($, view.agent)
  }
  // with the pane shut and no agent at work nothing of the deck's is on screen: the next event draws
  if (isPaneOpen || isAnyLive) redrawIfChanged($, now)
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

/** Opens agent `id`'s card; its conversation reloads when that view is the one open. */
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
    selectAgent: id => {
      pickAgent($, id)
      changed($)
    },
    selectMessage: id => {
      view.message = data.messages.some(message => message.id === id) ? id : ''
      const target = M.messageTargetOf(data, id)
      if (target) pickAgent($, target)
      changed($)
    },
    setMapView: map => {
      view.map = map
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
    review: text => {
      void $.prompt
        .fill({ text, mode: 'replace' })
        .then(filled => $.ui.toast(filled.isFilled ? 'The review request is in your prompt; press Enter to send it.' : 'Could not fill the prompt.'))
        .catch(() => $.ui.toast('Could not fill the prompt.'))
    },
    open: tab => {
      view.tab = tab
      changed($)
      void openPane($)
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
    // the terminal's table answers to Svg but draws nothing for it: there the map falls back to its railed tree
    ...('Svg' in ui && surface !== 'terminal' ? { Svg: ui.Svg } : {}),
  }
}

/** The state a drawing reads: the live model, as it is now. The map's Svg strings are built from it in the views, memoised by content. */
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
  }
}

/** Records exactly what an Edit, Write or NotebookEdit changed, from the tool's own patch. */
function recordEdit(agent: DeckAgent, tool: string, id: string, input: Record<string, unknown>, ran: ToolCallResult, now: number) {
  const abs = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
  if (!abs) return
  const record = (ran.result ?? null) as Record<string, unknown> | null
  if (record && record.staged === true) return

  const patch = record && Array.isArray(record.structuredPatch) ? (record.structuredPatch as unknown[]) : []
  let hunks: Hunk[] = patch
    .filter((hunk): hunk is Record<string, unknown> => typeof hunk === 'object' && hunk !== null)
    .map(hunk => ({
      oldStart: Number(hunk.oldStart) || 0,
      oldLines: Number(hunk.oldLines) || 0,
      newStart: Number(hunk.newStart) || 0,
      newLines: Number(hunk.newLines) || 0,
      lines: Array.isArray(hunk.lines) ? hunk.lines.map(line => F.clean(String(line))) : [],
    }))
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
  })
  // the next git refresh probes a directory not seen before, and follows the repository edited last
  R.noteEdit(book, abs, now)
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    cwd = e.cwd
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
      isPaneOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    } catch {
      isPaneOpen = false
    }

    try {
      sessionId = await $.session.id()
    } catch {
      sessionId = ''
    }

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
    timers.tick = $.clock.every(2500, () => void tick($))

    try {
      await $.command.register({
        name: 'deck',
        description: 'Open Agent Deck: who each agent is, what it is doing, how they talk, and the diffs they make',
        argumentHint: '[agents|changes|stats|band|close]',
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
    // a tab's name or its start; an earlier build's name (overview, diffs, commits, graph) lands on the tab that replaced it
    const tab = M.tabFor(arg)
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

  on('tool.call', async ($, e, next) => {
    const start = await $.clock.now()
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const agentId = e.agentId ?? M.MAIN
    const command = typeof input.command === 'string' ? input.command : ''
    const isShell = M.SHELL_TOOLS.includes(tool)
    const isEdit = M.EDIT_TOOLS.includes(tool)
    let agent: DeckAgent | undefined

    try {
      agent = M.ensureAgent(data, agentId, start)
      agent.endedAt = undefined
      // the agent the engine waited on for the person moved on
      M.clearNeeds(data, { kind: 'start', agent: agentId })
      M.beginTool(data, agent, M.activityOf(e.tool_use_id, tool, input, git.root || null, start))
      redraw($)
    } catch {
      agent = undefined
    }

    const before = isShell && git.isRepo && G.mayCommit(command) ? await runGit($, G.argv.head).then(ran => (ran.ok ? ran.out.trim() : '')) : ''
    const ran = await next(e)

    try {
      const end = await $.clock.now()
      const ok = ran.deny === undefined && ran.isError !== true
      if (agent) {
        M.endTool(agent, e.tool_use_id, ok, end)
        // a permission prompt holds its call: the call's end is the person's answer
        M.clearNeeds(data, { kind: 'end', agent: agentId, call: e.tool_use_id })
        if (ok && isEdit) recordEdit(agent, tool, e.tool_use_id, input, ran, end)
        if (ok && M.LIST_TOOLS.includes(tool)) M.noteTodo(data, agent, tool, input, ran.result)
      }
      if (isEdit || (isShell && G.mayChangeTree(command))) scheduleGit($, 700)
      if (isShell && ok && G.mayCommit(command)) void attributeCommits($, agentId, before)
      save($)
      redraw($)
    } catch {
      // tracking never changes what the tool returned
    }

    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    try {
      if (result.agentId) {
        const now = await $.clock.now()
        const parentId = e.parentAgentId ?? M.MAIN
        if (parentId !== M.MAIN) M.ensureAgent(data, parentId, now)
        const isNew = M.agentOf(data, result.agentId) === undefined
        const agent = M.ensureAgent(data, result.agentId, now)
        agent.kind = e.isTeammate ? 'teammate' : 'agent'
        if (e.name) agent.name = e.name
        agent.type = e.subagentType
        agent.description = e.description
        agent.prompt = F.trunc(e.prompt, M.LIMITS.promptChars)
        agent.parentId = parentId
        agent.model = result.model
        agent.status = 'running'
        agent.endedAt = undefined
        if (isNew) agent.startedAt = now
        M.addMessage(data, { from: parentId, to: agent.id, kind: 'spawn', text: e.prompt, at: now })
        changed($)
      }
    } catch {
      // the spawn stands whatever the deck makes of it
    }
    return result
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
      if (e.text.trim()) M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: e.text, at: now })
      changed($)
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
        if (agent.kind !== 'main' && M.isEnded(agent.status)) {
          agent.status = 'running'
          agent.endedAt = undefined
        }
        M.bump(data, now, 'tokens', usageOfStep.input_tokens + usageOfStep.output_tokens + usageOfStep.cache_creation_input_tokens + usageOfStep.cache_read_input_tokens)
        save($)
        redraw($)
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
          agent.current = undefined
          delete agent.todo
          if (e.answer.trim()) {
            agent.answer = F.trunc(e.answer.trim(), M.LIMITS.answerChars)
            M.addMessage(data, { from: agent.id, to: agent.parentId ?? M.MAIN, kind: 'result', text: e.answer, at: now })
          }
        }
      } else {
        const main = M.agentOf(data, M.MAIN)
        if (main) {
          main.status = 'idle'
          main.current = undefined
          main.lastAt = now
          delete main.todo
        }
        data.turns += 1
        data.turnMs += e.durationMs
        timers.day?.cancel()
        timers.day = $.clock.after(400, () => void recordDay($))
      }
      scheduleGit($, 300)
      if (chat && chat.agent === (e.agentId ?? M.MAIN)) void loadChat($, chat.agent)
      changed($)
    } catch {
      // the turn's end stands whatever the deck makes of it
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
        if (from !== M.MAIN) M.ensureAgent(data, from, now)
        const target = M.resolveRecipient(data, e.to) ?? M.peerOf(data, e.to, now)
        M.addMessage(data, { from, to: target.id, kind: 'message', text: e.text, at: now, isDelivered: result.isDelivered })
        changed($)
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
      if (origin.kind === 'peer' || origin.kind === 'coordinator' || origin.kind === 'peer-send-message') {
        const now = await $.clock.now()
        const to = e.agentId ?? M.MAIN
        const probe = F.oneLine(e.text).slice(0, 60)
        const echo = data.messages
          .slice(-16)
          .reverse()
          .find(message => message.to === to && now - message.at < 20_000 && (F.oneLine(message.text).includes(probe.slice(0, 40)) || probe.includes(F.oneLine(message.text).slice(0, 40))))
        if (echo) {
          echo.isDelivered = true
        } else if (!('plugin' in origin && origin.plugin === $.plugin.name)) {
          const from =
            'teammate' in origin
              ? (M.resolveRecipient(data, origin.teammate)?.id ?? M.peerOf(data, origin.teammate, now).id)
              : origin.kind === 'coordinator'
                ? M.MAIN
                : M.peerOf(data, origin.kind === 'peer-send-message' ? 'another session' : 'peer', now).id
          M.addMessage(data, { from, to, kind: 'message', text: e.text, at: now })
        }
        changed($)
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
        changed($)
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
    const isLive = data.agents.some(agent => (agent.kind === 'agent' || agent.kind === 'teammate') && M.isLive(agent.status))
    if (view.isBandHidden || e.props.hasSurvey || !isLive) return next(e)
    const theirs: RenderElement = await next(e)
    const now = await $.clock.now()
    // the band speaks for the screen only while the pane, which shows more, is shut
    if (!isPaneOpen) shownKey = screenKey(now)
    const kit = kitOf($.ui.resolve(e), e.surface, Math.max(24, e.props.bodyColumns))
    return bandView(kit, modelOf(now), actionsFor($), theirs) ?? theirs
  })
}
