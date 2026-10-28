/**
 * Now's reading of the v2 state (web/CONTRACT.md v2) for its dashboard, the
 * screen the old Dashboard drew, on v2's own truthful data: the agents in
 * card order, how many cards a row and what a card says (its step box, its
 * now line, its foot); the figures; Recent activity's rows; the files
 * grouped as the web's FILES card; and the one line a folded section says
 * (`FOLD`, its ids in the view's `collapsed`). Nothing in it is made up:
 * a card's step is the agent's own todo in hand or its task, its now line
 * its call in flight verbatim or what it handed back.
 *
 * `activity`, `files` and `figures` are the v2 state's own (the engine
 * builds them); a state without them (one an older build wrote) reads as no
 * calls, no files, and figures counted from its rows, header and plan as
 * the engine counts them.
 *
 * Pure: every function reads the state and the `now` it is handed.
 */
import { MAIN } from '../../model'
import { isFinishedRow, type V2Activity, type V2AgentRow, type V2Figures, type V2File, type V2Need, type V2Todo, type WebStateV2 } from '../../web'
import { ago, cellsOf, cutCells, flat, monoAdvance, msText, num, span, uiAdvance, usd, type Advance } from './text'

/** The state's tool calls (`activity`, newest first); none in a state without them. */
export function callsOf(state: WebStateV2): V2Activity[] {
  return Array.isArray(state.activity) ? state.activity : []
}

/** The files the agents edited (`files`); none in a state without them. */
export function filesOf(state: WebStateV2): V2File[] {
  return Array.isArray(state.files) ? state.files : []
}

/** The state's figures; counted from its rows, header and plan in a state without them. */
export function figuresOf(state: WebStateV2): V2Figures {
  return state.figures ?? figuresFrom(state)
}

/** The agents of the tree, its fold rows left out. */
export function agentRowsOf(state: Pick<WebStateV2, 'agents'>): V2AgentRow[] {
  return state.agents.filter((row): row is V2AgentRow => row.row === 'agent')
}

/** An agent's row by id. */
export function rowOf(state: Pick<WebStateV2, 'agents'>, id: string): V2AgentRow | undefined {
  return state.agents.find((row): row is V2AgentRow => row.row === 'agent' && row.id === id)
}

/** The plan's items, its task board's, else the Orchestrator's own list: what its figure counts. */
export function planItemsOf(state: Pick<WebStateV2, 'plan'>): { status: V2Todo['status']; text: string }[] {
  const plan = state.plan
  if (!plan) return []
  if (plan.board.length > 0) return plan.board.map(task => ({ status: task.status, text: task.status === 'active' && task.doing ? task.doing : task.subject }))
  return (plan.todos?.items ?? []).map(item => ({ status: item.status, text: item.status === 'active' && item.doing ? item.doing : item.text }))
}

/** The figures counted from what the state holds, as the engine counts them: its agents' statuses (stopped apart; the Orchestrator and Claude Code's own loops count for none), its plan's items, its header's spend and context, every row's tokens. */
export function figuresFrom(state: WebStateV2): V2Figures {
  const counts = { running: 0, waiting: 0, done: 0, failed: 0, stopped: 0 }
  const rows = agentRowsOf(state)
  for (const row of rows) {
    if (row.kind === 'orchestrator' || row.kind === 'engine') continue
    if (row.isStopped) counts.stopped++
    else if (row.status === 'running' || row.status === 'starting') counts.running++
    else if (row.status === 'waiting' || row.status === 'done' || row.status === 'failed') counts[row.status]++
  }
  const items = planItemsOf(state)
  return {
    ...counts,
    plan: items.length > 0 ? { done: items.filter(item => item.status === 'done').length, total: items.length } : null,
    costUsd: state.header.costUsd,
    tokens: rows.reduce((sum, row) => sum + (row.tokens || 0), 0),
    contextPercent: state.header.contextPercent,
    minutes: state.session.startedAt > 0 ? Math.max(0, Math.floor((state.now - state.session.startedAt) / 60_000)) : 0,
    needs: state.needs.length,
  }
}

// Text.

/** The first line that says something. */
export function firstLine(text: string): string {
  return flat(String(text ?? '').split('\n').find(line => line.trim() !== '') ?? '')
}

/** Markdown read as one line of words: each line's heading, list and quote marks dropped, bold marks dropped, code spans kept. */
export function plainLine(markdown: string): string {
  return flat(
    String(markdown ?? '')
      .split('\n')
      .map(line => line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, ''))
      .join(' ')
      .replace(/\*\*|__/g, ''),
  )
}

/** One run of a line: plain words, or a code span's. */
export type TickPart = { text: string; isCode: boolean }

/** A line with `code` spans: its plain and code parts in order. */
export function ticks(text: string): TickPart[] {
  return String(text ?? '')
    .split(/`([^`\n]+)`/)
    .map((part, i) => ({ text: part, isCode: i % 2 === 1 }))
    .filter(part => part.text !== '')
}

/** A desktop's advance a little over, for text laid into lines: a line the desktop drew past its room would lose its last words. */
export const uiWrapAdvance: Advance = ch => uiAdvance(ch) * 1.04

/**
 * A line with `code` spans laid into at most `rows` lines of at most `room`
 * cells each (as `advance` has them), broken at spaces (a word longer than a
 * line is cut across it), each line its plain and code runs in order. When
 * words are left over, the last line ends in "…". [] for a blank text. A
 * Button draws one line, so a pressable text of two lines is two Buttons.
 */
export function wrapTicks(text: string, room: number, rows: number, advance: Advance = monoAdvance): TickPart[][] {
  const chars: string[] = []
  const code: boolean[] = []
  for (const part of ticks(flat(text))) {
    for (const ch of Array.from(part.text)) {
      chars.push(ch)
      code.push(part.isCode)
    }
  }
  const sizes = chars.map(advance)
  const across = (from: number, to: number) => sizes.slice(from, to).reduce((sum, one) => sum + one, 0)
  const width = Math.max(2, Math.floor(room))
  const spans: [number, number][] = []
  let at = 0
  const skipSpaces = () => {
    while (at < chars.length && chars[at] === ' ') at++
  }
  skipSpaces()
  while (at < chars.length && spans.length < Math.max(1, rows)) {
    let end = at
    let used = 0
    while (end < chars.length && used + (sizes[end] ?? 1) <= width) used += sizes[end++] ?? 1
    if (end === at) end = at + 1
    if (end < chars.length && chars[end] !== ' ') {
      // back to the last space inside the line; a word longer than a whole line is cut where the line ends
      let space = end - 1
      while (space > at && chars[space] !== ' ') space--
      let wordEnd = space + 1
      while (wordEnd < chars.length && chars[wordEnd] !== ' ') wordEnd++
      if (space > at && across(space + 1, wordEnd) <= width) end = space
    }
    spans.push([at, end])
    at = end
    skipSpaces()
  }
  const isCut = at < chars.length
  const dots = advance('…')
  return spans.map(([from, to], i) => {
    const isLast = isCut && i === spans.length - 1
    let line = chars.slice(from, to)
    let lineCode = code.slice(from, to)
    if (isLast) {
      while (line.length > 0 && across(from, from + line.length) + dots > width) {
        line = line.slice(0, -1)
        lineCode = lineCode.slice(0, -1)
      }
    }
    while (line.length > 0 && line[line.length - 1] === ' ') {
      line = line.slice(0, -1)
      lineCode = lineCode.slice(0, -1)
    }
    const parts: TickPart[] = []
    line.forEach((ch, j) => {
      const isCode = lineCode[j] === true
      const last = parts[parts.length - 1]
      if (last && last.isCode === isCode) last.text += ch
      else parts.push({ text: ch, isCode })
    })
    if (isLast) parts.push({ text: '…', isCode: false })
    return parts
  })
}

/** An age in a sentence: "just now", "4m ago". */
export function agoText(at: number, now: number): string {
  const said = ago(at, now)
  return said === 'now' ? 'just now' : `${said} ago`
}

// The agents' cards.

/** The narrowest an agent card is drawn, in cells: the web grid's 244 px minimum with its gap, at a desktop's cell of about 7.85 px. */
export const CARD_MIN = 32

/** The most cards a row holds: six, as the web's grid shows at the pane's widest. */
export const CARDS_MAX = 6

/** Agent cards a row across `columns` cells: as many as fit at CARD_MIN cells with a cell between, one to six. Two at the pane's usual 68 to 84, three from 98, four from 131, five from 164, six from 197. */
export function cardsPerRow(columns: number): number {
  return Math.max(1, Math.min(CARDS_MAX, Math.floor((columns + 1) / (CARD_MIN + 1))))
}

/** The cards Now shows at most; past it, the Orchestrator and the newest. */
export const MOST_CARDS = 12

/** Now's cards: those in front, those behind the "N finished" row (drawn while it is open), how many neither shows, and how many are finished. */
export type CardGroups = { shown: V2AgentRow[]; finished: V2AgentRow[]; hidden: number; finishedCount: number }

/**
 * Now's cards: the Orchestrator, then the agents at work or waiting on you,
 * in the order they started (new ones append; at one moment, in the tree's
 * order), in front; the finished ones (done, failed, stopped or idle:
 * W.isFinishedRow) behind one "N finished" row, drawn only while it is open
 * (`isFinishedOpen`). The agents "Clear finished" hid are in neither. Past
 * twelve in front, the Orchestrator, every one waiting on you and the newest
 * of the rest; past twelve behind, the newest twelve.
 */
export function cardAgentsOf(state: Pick<WebStateV2, 'agents'>, isFinishedOpen = false): CardGroups {
  const list = agentRowsOf(state)
    .filter(row => !row.isCleared)
    .sort((x, y) => Number(y.id === MAIN) - Number(x.id === MAIN) || x.startedAt - y.startedAt)
  const front = list.filter(row => !isFinishedRow(row))
  const done = list.filter(row => isFinishedRow(row))
  // past twelve: the Orchestrator, every one waiting on you, then the newest
  const keep = new Set(front.filter(row => row.id === MAIN).map(row => row.id))
  for (let i = front.length - 1; i >= 0 && keep.size < MOST_CARDS; i--) if ((front[i] as V2AgentRow).status === 'waiting') keep.add((front[i] as V2AgentRow).id)
  for (let i = front.length - 1; i >= 0 && keep.size < MOST_CARDS; i--) keep.add((front[i] as V2AgentRow).id)
  const shown = front.length <= MOST_CARDS ? front : front.filter(row => keep.has(row.id))
  const finished = isFinishedOpen ? done.slice(-MOST_CARDS) : []
  return { shown, finished, hidden: front.length - shown.length + (isFinishedOpen ? done.length - finished.length : 0), finishedCount: done.length }
}

export function isRunning(status: string): boolean {
  return status === 'running' || status === 'starting'
}

/** How a card's step box marks its words: done, in hand, failed, waiting on you, idle. */
export type ChipGlyph = 'done' | 'active' | 'failed' | 'waiting' | 'idle'

/** What a card's step box says: its glyph, its words, and the agent's todos done of all ("1/3"; '' with none). */
export type Chip = { text: string; glyph: ChipGlyph; n: string }

/**
 * A card's step box: the agent's own todo in hand (its words for what it is
 * doing), else its task's first line (the Orchestrator's: your request),
 * else its description or type; "n/total" its own todos. Its glyph by how
 * it stands: a list all done reads done.
 */
export function chipOf(state: Pick<WebStateV2, 'header'>, row: V2AgentRow): Chip {
  const todos = row.todos
  const done = todos.filter(todo => todo.status === 'done').length
  const active = todos.find(todo => todo.status === 'active')
  const goal = row.id === MAIN ? (state.header.goal?.headline ?? '') : ''
  const text = (active ? flat(active.doing || active.text) : '') || firstLine(row.task) || flat(goal) || flat(row.description) || row.type || '—'
  const isAllDone = todos.length > 0 && done === todos.length
  const glyph: ChipGlyph =
    row.status === 'waiting' ? 'waiting' : row.status === 'failed' ? 'failed' : row.status === 'done' || (isAllDone && !isRunning(row.status)) ? 'done' : row.status === 'idle' ? 'idle' : 'active'
  return { text, glyph, n: todos.length > 0 ? `${done}/${todos.length}` : '' }
}

/** A card's now line: its call in flight verbatim ("Bash npm test"); else, once it is not at work, what it handed back; '' for neither. */
export function cardLine(row: V2AgentRow): string {
  if (row.live) return flat(`${row.live.tool} ${row.live.text}`)
  if (isRunning(row.status)) return ''
  return plainLine(row.result)
}

/** "haiku-4.5 · 48k": the model and the tokens spent, these left out until there are some. */
export function modelLine(row: V2AgentRow): string {
  return [row.model || '—', row.tokens > 0 ? num(row.tokens) : ''].filter(Boolean).join(' · ')
}

/** When it ran, as a card's foot says it: "Started 4m ago", "Finished 2m ago", "Failed 1h ago", "Stopped 3m ago", "Waiting · 12m". */
export function runTitle(row: V2AgentRow, now: number): string {
  const ended = row.endedAt ?? row.startedAt
  const from = runStartOf(row)
  if (row.isStopped) return `Stopped ${agoText(ended, now)}`
  if (row.status === 'done') return `Finished ${agoText(ended, now)}`
  if (row.status === 'failed') return `Failed ${agoText(ended, now)}`
  if (row.status === 'waiting') return `Waiting · ${span(now - from)}`
  // a message woke it: the same agent, resumed, no new start
  return `${from > row.startedAt ? 'Resumed' : 'Started'} ${agoText(from, now)}`
}

/** When its run began: its start, or when a message last woke it. */
function runStartOf(row: V2AgentRow): number {
  return Math.max(row.startedAt, row.resumedAt ?? 0)
}

/** The same in fewer words, for a narrow card: "4m ago", "just now", "12m" while it waits. */
export function runShort(row: V2AgentRow, now: number): string {
  if (row.status === 'waiting' && !row.isStopped) return span(now - runStartOf(row))
  const isOver = row.isStopped || row.status === 'done' || row.status === 'failed'
  return agoText(isOver ? (row.endedAt ?? row.startedAt) : runStartOf(row), now)
}

// The figures.

/** One figure's tile: its value, what it counts, one line under it (code spans in backticks). */
export type Tile = { key: 'running' | 'plan' | 'spend' | 'waiting'; value: string; label: string; desc: string }

/** What needs you, in one line: who asks what, who needs your OK for which command or file, a notification's words. */
export function needLine(need: V2Need): string {
  if (need.kind === 'question') {
    const qs = need.questions ?? []
    return qs.length > 1 ? `${need.agentName} asks ${qs.length} questions` : `${need.agentName} asks: ${firstLine(qs[0]?.question ?? need.text) || 'a question'}`
  }
  if (need.kind === 'permission') {
    const what = firstLine(need.command ?? need.path ?? '')
    return `${need.agentName} needs your OK${need.tool ? ` for ${need.tool}` : ''}${what && !what.includes('`') ? ` \`${what}\`` : ''}`
  }
  return firstLine(need.text) || need.title || 'Claude Code needs you'
}

/**
 * The figures' tiles: agents running ("n waiting · n done · n failed"), the
 * plan's items only where Claude made a plan, the session's spend ("tokens ·
 * min · context"), and what waits on you.
 */
export function tilesOf(state: WebStateV2, figures: V2Figures): Tile[] {
  const f = figures
  const tiles: Tile[] = [
    { key: 'running', value: String(f.running), label: 'Agents running', desc: [`${f.waiting} waiting`, `${f.done} done`, `${f.failed} failed`, f.stopped > 0 ? `${f.stopped} stopped` : ''].filter(Boolean).join(' · ') },
  ]
  if (f.plan) {
    const active = planItemsOf(state).find(item => item.status === 'active')
    const desc = active ? `Now: ${flat(active.text)}` : f.plan.done >= f.plan.total ? 'All steps done' : `${f.plan.total - f.plan.done} to go`
    tiles.push({ key: 'plan', value: `${f.plan.done}/${f.plan.total}`, label: 'Plan steps', desc })
  }
  const spend = [f.tokens > 0 ? `${num(f.tokens)} tokens` : '', f.minutes < 1 ? '<1 min' : `${f.minutes} min`, f.contextPercent === null ? '' : `context ${Math.round(f.contextPercent)}%`].filter(Boolean).join(' · ')
  tiles.push({ key: 'spend', value: usd(f.costUsd), label: 'Session spend', desc: spend || '—' })
  const first = state.needs[0]
  tiles.push({ key: 'waiting', value: String(f.needs), label: 'Waiting on you', desc: first ? needLine(first) : 'Nothing waits on you' })
  return tiles
}

// Recent activity.

/** What a call did, as the page says it after the agent's name. */
export const TOOL_VERB: Readonly<Record<string, string>> = {
  Read: 'read',
  Edit: 'edited',
  MultiEdit: 'edited',
  NotebookEdit: 'edited',
  Write: 'wrote',
  Bash: 'ran',
  PowerShell: 'ran',
  Grep: 'searched',
  Glob: 'listed',
  WebFetch: 'fetched',
  WebSearch: 'searched the web for',
  Agent: 'started',
  Task: 'started',
  SendMessage: 'messaged',
  TodoWrite: 'updated its todos',
  TaskCreate: 'added the task',
  TaskUpdate: 'updated',
  TaskGet: 'read',
  TaskList: 'read',
  ToolSearch: 'loaded',
  Skill: 'used',
  AskUserQuestion: 'asked you:',
}

/** What a call did: "edited", "ran", "asked you:"; for a tool it has no word for, "used <tool> on" ("used an MCP tool on"), "on" left out with no target. */
export function verbOf(tool: string, hasTarget: boolean): string {
  return TOOL_VERB[tool] ?? `used ${tool.startsWith('mcp__') ? 'an MCP tool' : tool}${hasTarget ? ' on' : ''}`
}

/** How a call stands beside its row: running, waiting on you, failed, or how long it took; and its mark ('' for none). */
export type Outcome = { text: string; tone: 'live' | 'wait' | 'fail' | 'quiet'; mark: string }

/** One row of Recent activity: who, what it did to what, how it went, when. */
export type ActivityRow = { key: string; agent: string; name: string; avatar: number | null; verb: string; text: string; outcome: Outcome; at: number }

function outcomeOf(state: Pick<WebStateV2, 'agents'>, call: V2Activity): Outcome {
  // refused, as Inspect's permission decisions say: by a hook, or by auto mode, a rule or you
  if (call.refused) return { text: call.refused, tone: 'fail', mark: '⊘' }
  if (call.ok === false) return { text: 'failed', tone: 'fail', mark: '✕' }
  if (call.ok === true) return { text: msText(call.ms) || 'ok', tone: 'quiet', mark: '' }
  const row = rowOf(state, call.agent)
  if (row?.status === 'waiting') return { text: 'waiting', tone: 'wait', mark: '◐' }
  if (row && !isRunning(row.status)) return { text: msText(call.ms) || '—', tone: 'quiet', mark: '' }
  return { text: 'running', tone: 'live', mark: '◐' }
}

/** The newest `most` tool calls of every agent, newest first, each keyed by its call's id (one key once). */
export function activityRows(state: WebStateV2, most = 10): ActivityRow[] {
  const calls = callsOf(state)
    .map((call, i) => ({ call, i }))
    .sort((x, y) => (y.call.at || 0) - (x.call.at || 0) || y.i - x.i)
    .slice(0, Math.max(0, most))
  const seen = new Map<string, number>()
  return calls.map(({ call }) => {
    const row = rowOf(state, call.agent)
    const base = String(call.id || `${call.at}:${call.agent}:${call.tool}`)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    const text = flat(call.text || '')
    return {
      key: n === 0 ? base : `${base}:${n}`,
      agent: call.agent,
      name: flat(call.agentName || row?.title || call.agent),
      avatar: row ? row.avatar : null,
      verb: verbOf(call.tool, text !== ''),
      text,
      outcome: outcomeOf(state, call),
      at: call.at,
    }
  })
}

// Files.

/** A path as two paths are compared: forward slashes, no leading "./", one case. */
export function pathKey(path: string): string {
  return String(path ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase()
}

/** A path split at its last slash: its folder (with the slash; '' at the top) and its name. */
export function splitPath(path: string): { dir: string; name: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return { dir: at >= 0 ? path.slice(0, at + 1) : '', name: at >= 0 ? path.slice(at + 1) : path }
}

/** A path outside the repository as the web shows it: its last two parts after "…/", one of two parts or fewer whole. */
export function shortPath(path: string): { dir: string; name: string } {
  const parts = String(path ?? '')
    .split(/[\\/]+/)
    .filter(part => part !== '')
  return splitPath(parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : String(path ?? ''))
}

/** One row of Files: the file split into its folder and its name, its editors, its lines, and its path as Changes lists it ('' where Changes does not). */
export type FileRow = { path: string; dir: string; name: string; editors: string[]; isShared: boolean; added: number; removed: number; lastAt: number; isOutside: boolean; changesPath: string }

/** Files as the web's FILES card groups them: the repository's own (the newest `most`), how many those are, and apart from them those outside it. */
export type FileGroups = { inside: FileRow[]; insideCount: number; outside: FileRow[] }

/** The files the agents edited, the one edited last first: the repository's own, and those outside it apart, each by its last two parts. */
export function fileGroupsOf(state: WebStateV2, most = 10): FileGroups {
  const listed = new Map(state.changes.files.map(file => [pathKey(file.path), file.path]))
  const all = filesOf(state)
    .map((file, i) => ({ file, i }))
    .sort((x, y) => (y.file.lastAt || 0) - (x.file.lastAt || 0) || x.i - y.i)
    .map(({ file }): FileRow => {
      const editors = [...new Set(file.editors)]
      return {
        path: file.path,
        ...splitPath(file.path),
        editors,
        isShared: editors.length >= 2,
        added: file.added || 0,
        removed: file.removed || 0,
        lastAt: file.lastAt || 0,
        isOutside: file.isOutside === true,
        changesPath: listed.get(pathKey(file.path)) ?? '',
      }
    })
  const inside = all.filter(row => !row.isOutside)
  return {
    inside: inside.slice(0, Math.max(0, most)),
    insideCount: inside.length,
    outside: all.filter(row => row.isOutside).map(row => ({ ...row, ...shortPath(row.path) })),
  }
}

/**
 * A row's path fitted to `room` cells: the name whole where it fits, its
 * folder cut from the start ("…/stores/") to make room; a name too long on
 * its own cut at its end, with no folder.
 */
export function fitPath(dir: string, name: string, room: number, advance: Advance = monoAdvance): { dir: string; name: string } {
  const nameCells = cellsOf(name, advance)
  const dirChars = Array.from(dir)
  const dots = advance('…')
  if (cellsOf(dir, advance) + nameCells <= room) return { dir, name }
  if (nameCells >= room - dots) return { dir: '', name: cutCells(name, Math.max(2, room), advance) }
  let keep = 0
  let used = nameCells + dots
  while (keep < dirChars.length && used + advance(dirChars[dirChars.length - 1 - keep] ?? '') <= room) used += advance(dirChars[dirChars.length - 1 - keep++] ?? '')
  return { dir: keep > 0 ? `…${dirChars.slice(dirChars.length - keep).join('')}` : '', name }
}

// Folded sections.

/** The ids of Now's sections a press on their head folds to it and one line (`DeckView.collapsed`). */
export const FOLD = {
  agents: 'dash:agents',
  figures: 'dash:figures',
  plan: 'dash:plan',
  activity: 'dash:activity',
  files: 'dash:files',
} as const

function foldLine(parts: readonly string[]): string {
  return parts.filter(part => part !== '').join(' · ')
}

/** The agents folded: how many run, wait on you, failed, stopped and are done, those with none left out ("2 running · 1 waiting"). */
export function agentsFoldOf(state: WebStateV2): string {
  const f = figuresOf(state)
  const said = foldLine([f.running ? `${f.running} running` : '', f.waiting ? `${f.waiting} waiting` : '', f.failed ? `${f.failed} failed` : '', f.stopped ? `${f.stopped} stopped` : '', f.done ? `${f.done} done` : ''])
  return said || (agentRowsOf(state).length === 0 ? 'none yet' : '')
}

/** The figures folded: each one's value in a few words ("2 running · 1/3 steps · $0.42 · 1 waiting on you"). */
export function figuresFoldOf(state: WebStateV2): string {
  const f = figuresOf(state)
  return foldLine([`${f.running} running`, f.plan ? `${f.plan.done}/${f.plan.total} steps` : '', usd(f.costUsd), `${f.needs} waiting on you`])
}

/** The plan folded: its items done of all, and the one in hand. */
export function planFoldOf(state: WebStateV2): string {
  const items = planItemsOf(state)
  const active = items.find(item => item.status === 'active')
  const done = items.filter(item => item.status === 'done').length
  return foldLine([items.length > 0 ? `${done} of ${items.length} done` : '', active ? flat(active.text) : '', state.plan?.approved ? 'approved plan' : ''])
}

/** Recent activity folded: how many of its newest calls still run, then the newest call and its age ("builder ran npm test · 2m"). */
export function activityFoldOf(state: WebStateV2, most = 10): string {
  const rows = activityRows(state, most)
  const newest = rows[0]
  if (!newest) return 'No tool calls yet'
  const live = rows.filter(row => row.outcome.tone === 'live' || row.outcome.tone === 'wait').length
  const call = [newest.name, newest.verb, cutCells(newest.text, 60)].filter(Boolean).join(' ')
  return foldLine([live ? `${live} running` : '', call, ago(newest.at, state.now)])
}

/** Files folded: of the repository's, how many more than one agent edited and their lines +a −r, and how many lie outside the repo. */
export function filesFoldOf(state: WebStateV2): string {
  const groups = fileGroupsOf(state, Number.POSITIVE_INFINITY)
  if (groups.inside.length + groups.outside.length === 0) return 'No files edited yet'
  const shared = groups.inside.filter(row => row.isShared).length
  const added = groups.inside.reduce((sum, row) => sum + row.added, 0)
  const removed = groups.inside.reduce((sum, row) => sum + row.removed, 0)
  return foldLine([shared ? `${shared} shared` : '', groups.inside.length > 0 ? `+${added} −${removed}` : '', groups.outside.length > 0 ? `${groups.outside.length} outside the repo` : ''])
}
