/**
 * The native dashboard's reading of the web deck's state (`WebState`, as
 * `webStateOf` builds it for the page): coarse times and counts worded as
 * the page words them, what waits on you, the agents in card order, how many
 * cards a row and what a card says (its step box, its line, when it ran), the
 * KPI figures, the activity rows, the files grouped as the web's FILES card,
 * the goal's words after its headline, and the agents as the org chart takes
 * them; and how much room text takes, a cell a character on the terminal and
 * by the letter in a desktop's proportional face. The page's own helpers (web/app.js)
 * carried over, so the pane and the page always say the same.
 *
 * Pure: every function reads the state and the `now` it is handed.
 */
import type { DeckAgentPane } from '../../../types'
import type { WebAgent, WebPending, WebState } from '../../web'
import type { OrgAgent } from './orgLayout'

// Times and figures, as the page words them.

/** A coarse age: "now", "4m", "2h", "3d". */
export function ago(at: number, now: number): string {
  if (!at) return ''
  const s = Math.max(0, (now - at) / 1000)
  if (s < 45) return 'now'
  const m = Math.max(1, Math.floor(s / 60))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

/** The same in a sentence: "just now", "4m ago". */
export function agoText(at: number, now: number): string {
  const said = ago(at, now)
  return said === 'now' ? 'just now' : `${said} ago`
}

/** A coarse duration: "<1m", "4m", "1h 12m", "2d 3h". */
export function span(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

/** 842, 4.2k, 48k, 1.2M. */
export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  if (n < 1000) return String(Math.round(n))
  if (n < 1e5) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1e6) return `${Math.round(n / 1000)}k`
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
}

/** "$6.42"; "—" while the spend is not known. */
export function usd(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : `$${x.toFixed(2)}`
}

/** A call's time: "840ms", "2.4s", "12s", then minutes. */
export function msText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return span(ms)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** `text` cut to `max` characters with an ellipsis. */
export function cut(text: string, max: number): string {
  const chars = Array.from(text)
  if (max <= 1) return chars.slice(0, Math.max(0, max)).join('')
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

/** One line: control characters and runs of white space become one space. */
export function flat(text: string): string {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The first line that says something. */
export function firstLine(text: string): string {
  return flat(String(text ?? '').split('\n').find(line => line.trim() !== '') ?? '')
}

/**
 * `text` folded to about `rows` rows of a column `width` cells wide, as a
 * wrapping Text lays it out (its own lines kept, each taking a row or more;
 * a row counted a little short, for the words wrapping leaves over), and
 * whether anything was left out. A line cut part way ends in "…".
 */
export function foldText(text: string, width: number, rows: number): { text: string; isCut: boolean } {
  const perRow = Math.max(2, Math.floor(width) - 2)
  const lines = String(text ?? '').split('\n')
  const shown: string[] = []
  let left = Math.max(1, rows)
  for (const [i, line] of lines.entries()) {
    const need = Math.max(1, Math.ceil(Array.from(line).length / perRow))
    if (need > left) {
      shown.push(cut(line, Math.max(2, left * perRow)))
      return { text: shown.join('\n'), isCut: true }
    }
    shown.push(line)
    left -= need
    if (left === 0 && i < lines.length - 1) return { text: shown.join('\n'), isCut: lines.slice(i + 1).some(rest => rest.trim() !== '') }
  }
  return { text: shown.join('\n'), isCut: false }
}

/** A line with `code` spans, as the mod words a wait ("Needs your OK to run `npm test`"): its plain and code parts in order. */
export function ticks(text: string): { text: string; isCode: boolean }[] {
  return String(text ?? '')
    .split(/`([^`\n]+)`/)
    .map((part, i) => ({ text: part, isCode: i % 2 === 1 }))
    .filter(part => part.text !== '')
}

/** The same with its backticks dropped. */
export function plainTicks(text: string): string {
  return String(text ?? '').replace(/`([^`\n]+)`/g, '$1')
}

/** One run of a line as `ticks` and `wrapTicks` give it: plain words, or a code span's. */
export type TickPart = { text: string; isCode: boolean }

// How much room text takes: a cell a character on the terminal, less in a desktop's proportional face.

/** The cells one character takes where it is drawn. */
export type Advance = (ch: string) => number

/** A monospace surface's: a cell a character, as the terminal draws them. */
export const monoAdvance: Advance = () => 1

/** Code points a proportional face draws two cells wide: the wide East Asian scripts and the emoji. */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

/**
 * The desktop's UI face, Anthropic Sans at 13 px: each printable ASCII
 * character's advance from " " to "~", in widths of its "0" (the desktop's
 * cell, `1ch`), as measured from the face the Desktop app ships, each rounded up.
 */
const UI_ASCII =
  '.36 .4 .68 1.06 .87 1.65 1.14 .4 .67 .67 .81 1.06 .4 .6 .4 .56 1 .62 .97 .93 1.02 .94 .95 .89 .93 .95 .4 .4 1.06 1.06 1.06 .9 1.45 1.22 1.09 1.27 1.23 1.06 .99 1.32 1.23 .46 .9 1.14 .96 1.56 1.31 1.36 1.02 1.36 1.13 .98 .96 1.21 1.22 1.68 1.12 1.13 1.1 .67 .56 .67 1.06 .83 .83 .91 1.03 .92 1.03 .96 .66 .92 .99 .42 .42 .94 .42 1.45 .99 .97 1.03 1.03 .67 .85 .66 .98 .94 1.37 .95 .95 .84 .67 .51 .67 1.06'
    .split(' ')
    .map(Number)

/** The same for the marks the deck writes beyond ASCII. */
const UI_MORE: Readonly<Record<string, number>> = { '·': 0.4, '→': 1.36, '←': 1.36, '…': 1.66, '—': 1.66, '–': 0.83, '◐': 1.41, '✕': 1.36, '✓': 1.24, '‖': 0.47, '•': 0.83, '●': 1, '−': 1.06, '“': 0.68, '”': 0.68, '’': 0.4, '‘': 0.4 }

/**
 * A desktop's: its UI face is proportional and its cell is that face's "0",
 * so a space takes about a third of a cell and an m nearly one and a half; a
 * line of prose about three quarters of a cell a character. ASCII and the
 * deck's own marks as measured; East Asian scripts and emoji two cells; any
 * other letter about one. A line a little long for its room is cut again by
 * the desktop itself, with "…".
 */
export const uiAdvance: Advance = ch => {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 32 && code < 127) return UI_ASCII[code - 32] ?? 1
  return UI_MORE[ch] ?? (isWide(code) ? 2 : 1.05)
}

/** The same a little over, for text laid into lines: a line the desktop drew past its room would lose its last words, which the next line does not repeat. */
export const uiWrapAdvance: Advance = ch => uiAdvance(ch) * 1.04

/** The cells `text` takes, each character as `advance` has it. */
export function cellsOf(text: string, advance: Advance = monoAdvance): number {
  let cells = 0
  for (const ch of Array.from(String(text ?? ''))) cells += advance(ch)
  return cells
}

/** `text` cut with an ellipsis to fit `cells`, each character as `advance` has it; as `cut` on a monospace surface. */
export function cutCells(text: string, cells: number, advance: Advance = monoAdvance): string {
  if (cellsOf(text, advance) <= cells) return text
  const chars = Array.from(text)
  const dots = advance('…')
  const kept: string[] = []
  let used = 0
  for (const ch of chars) {
    const next = advance(ch)
    if (used + next + dots > cells) break
    kept.push(ch)
    used += next
  }
  if (kept.length === 0) return used + dots <= cells ? '…' : ''
  return `${kept.join('').trimEnd()}…`
}

/**
 * A line with `code` spans laid into at most `rows` lines of at most `room`
 * cells each (a character a cell, or as `advance` has it), broken at spaces
 * (a word longer than a line is cut across it), each line its plain and code
 * runs in order. When words are left over, the last line ends in "…". [] for
 * a blank text. A Button draws one line, so a pressable text of two lines is
 * two Buttons, one a line.
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
    // the furthest end whose characters fit the line, and at least one
    let end = at
    let used = 0
    while (end < chars.length && used + (sizes[end] ?? 1) <= width) used += sizes[end++] ?? 1
    if (end === at) end = at + 1
    if (end < chars.length && chars[end] !== ' ') {
      // back to the last space inside the line, so the word it splits starts the next one; a word
      // longer than a whole line (a long path) is cut where the line ends instead, rather than leave it short
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
      // room for the "…" at its end
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

// Agents.

export function isRunning(status: string): boolean {
  return status === 'running' || status === 'starting'
}

export function isLive(status: string): boolean {
  return isRunning(status) || status === 'waiting'
}

export function agentOf(state: WebState, id: string): WebAgent | undefined {
  return state.agents.find(agent => agent.id === id)
}

/** The name the page gives an id: its agent's label, You, else the id. */
export function nameOf(state: WebState, id: string): string {
  if (id === 'you') return 'You'
  return agentOf(state, id)?.label ?? id
}

/** Every token an agent spent: in, out and cache reads. */
export function tokensOf(agent: WebAgent): number {
  const t = agent.tokens
  return t ? (t.in || 0) + (t.out || 0) + (t.cacheRead || 0) : 0
}

/** "haiku-4.5 · 48k": the model and the tokens spent, these left out until there are some. */
export function modelLine(agent: WebAgent): string {
  const tokens = tokensOf(agent)
  return [agent.model || '—', tokens > 0 ? num(tokens) : ''].filter(Boolean).join(' · ')
}

/** When it ran, in the page's words: "started 4m ago", "finished 2m ago", "failed 1h ago", "waiting · 12m". */
export function runTime(agent: WebAgent, now: number): string {
  if (agent.status === 'done') return `finished ${agoText(agent.endedAt || agent.startedAt, now)}`
  if (agent.status === 'failed') return `failed ${agoText(agent.endedAt || agent.startedAt, now)}`
  if (agent.status === 'waiting') return `waiting · ${span(now - agent.startedAt)}`
  return `started ${agoText(agent.startedAt, now)}`
}

/** A card's foot: "model · tokens · started 4m ago". */
export function cardFoot(agent: WebAgent, now: number): string {
  return `${modelLine(agent)} · ${runTime(agent, now)}`
}

/** A card's now line: the agent's line, never blank while it works. */
export function nowLine(agent: WebAgent): string {
  const said = flat(agent.now)
  if (said !== '') return said
  return isRunning(agent.status) ? 'Working' : ''
}

// An agent card, as the web's `RunCard` draws it.

/** The narrowest an agent card is drawn, in cells: the web grid's 244 px minimum with its 16 px gap, at a desktop's cell of about 7.85 px (the same 13 px face). */
export const CARD_MIN = 32

/** The most cards a row holds: six, as the web's grid shows at the pane's widest. */
export const CARDS_MAX = 6

/**
 * Agent cards a row across `columns` cells (the tab's, a cell under the
 * pane's), as the web grid's auto-fill lays them: as many as fit at CARD_MIN
 * cells or more with a cell between them, one to six. So in a pane of 66
 * cells or more two (its usual 68 to 84), from 99 three, from 132 four, from
 * 165 five, from 198 six.
 */
export function cardsPerRow(columns: number): number {
  return Math.max(1, Math.min(CARDS_MAX, Math.floor((columns + 1) / (CARD_MIN + 1))))
}

/** How a card's step box marks its words: done, in hand, failed, waiting on you, or idle (the web's GLYPH names). */
export type ChipGlyph = 'done' | 'active' | 'failed' | 'waiting' | 'idle'

/** What a card's step box says: its glyph, its words, and the steps done of all ("1/3"; '' with none). */
export type Chip = { text: string; glyph: ChipGlyph; n: string }

/**
 * A card's step box, as the web's `chipOf`: an agent's scope, else its
 * task's first line, else its type, with its checklist's count; the
 * Orchestrator's place in the plan (the step in hand, else "Plan done" or
 * "2 of 5 steps done") with the plan's count, as the goal it would repeat
 * stands right above it.
 */
export function chipOf(state: WebState, agent: WebAgent): Chip {
  const steps = state.plan.steps
  if (agent.kind === 'orchestrator' && steps.length > 0) {
    const done = steps.filter(step => step.status === 'done').length
    const isAllDone = done === steps.length
    const text = flat(state.summary.stepText ?? '') || (isAllDone ? 'Plan done' : `${done} of ${steps.length} steps done`)
    const glyph: ChipGlyph = isAllDone ? 'done' : state.agents.some(one => isRunning(one.status)) ? 'active' : 'idle'
    return { text, glyph, n: `${done}/${steps.length}` }
  }
  const list = agent.checklist
  const glyph: ChipGlyph = agent.status === 'waiting' ? 'waiting' : agent.status === 'failed' ? 'failed' : agent.status === 'done' ? 'done' : agent.status === 'idle' ? 'idle' : 'active'
  const total = list?.total ?? 0
  return { text: flat(agent.scope) || firstLine(agent.task) || agent.type, glyph, n: total > 0 ? `${list?.done ?? 0}/${total}` : '' }
}

/** A card's body, as the web's: its now line, never the step box's words again ("Working" while it runs), else its result. */
export function cardLine(agent: WebAgent, chip: string): string {
  const said = flat(agent.now)
  if (said !== '' && said !== chip) return said
  if (isRunning(agent.status)) return 'Working'
  return said || firstLine(agent.result)
}

/** When it ran, as the web's card foot says it: "Started 4m ago", "Finished 2m ago", "Failed 1h ago", "Waiting · 12m". */
export function runTitle(agent: WebAgent, now: number): string {
  const said = runTime(agent, now)
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}`
}

/** The same in fewer words, for a narrow card: "4m ago", "just now", "12m" while it waits. */
export function runShort(agent: WebAgent, now: number): string {
  if (agent.status === 'waiting') return span(now - agent.startedAt)
  const isOver = agent.status === 'done' || agent.status === 'failed'
  return agoText(isOver ? agent.endedAt || agent.startedAt : agent.startedAt, now)
}

/** The cards the dashboard shows at most; past it, the Orchestrator and the newest. */
export const MOST_CARDS = 12

/** The dashboard's cards: the Orchestrator, then the agents in the order they started (stable: new ones append); past twelve, the Orchestrator and the newest eleven. */
export function dashAgents(state: WebState): { shown: WebAgent[]; hidden: number } {
  const list = [...state.agents].sort((x, y) => Number(y.kind === 'orchestrator') - Number(x.kind === 'orchestrator') || x.startedAt - y.startedAt || (x.id < y.id ? -1 : 1))
  if (list.length <= MOST_CARDS) return { shown: list, hidden: 0 }
  const [first, ...rest] = list
  return { shown: [...(first ? [first] : []), ...rest.slice(rest.length - (MOST_CARDS - 1))], hidden: list.length - MOST_CARDS }
}

/**
 * The pane an agent's page opens on first, as the web deck's: the
 * Orchestrator's Talk (its answers to you); an agent's Diffs where it
 * edited, Activity while it works, Talk once it ended. So no page opens on
 * a pane it has nothing for.
 */
export function firstPaneOf(state: WebState, id: string): DeckAgentPane {
  const agent = agentOf(state, id)
  if (agent?.kind === 'orchestrator') return 'chat'
  if (state.edits.some(edit => edit.agent === id)) return 'edits'
  return agent && isLive(agent.status) ? 'activity' : 'chat'
}

/** Who an agent reports to: its parent agent, you for the Orchestrator, nobody for one the deck cannot place. */
export function reportsTo(state: WebState, agent: WebAgent): { id: string | null; name: string } {
  const parent = agent.parent && agent.parent !== agent.id ? agentOf(state, agent.parent) : undefined
  if (parent) return { id: parent.id, name: parent.label }
  if (agent.kind === 'orchestrator') return { id: null, name: 'you' }
  return { id: null, name: '—' }
}

/** Each agent's parent among the state's agents (null for a root), as the web's index places them. */
function parentsOf(state: WebState): Map<string, string | null> {
  const ids = new Set(state.agents.map(agent => agent.id))
  return new Map(state.agents.map(agent => [agent.id, agent.parent && agent.parent !== agent.id && ids.has(agent.parent) ? agent.parent : null]))
}

/** The agents in tree order, each with its depth: the Orchestrator first, everyone under who started them, siblings in start order. */
export function treeOf(state: WebState): { agent: WebAgent; depth: number }[] {
  const parents = parentsOf(state)
  const order = (x: WebAgent, y: WebAgent) => Number(y.kind === 'orchestrator') - Number(x.kind === 'orchestrator') || x.startedAt - y.startedAt || (x.id < y.id ? -1 : 1)
  const kids = new Map<string, WebAgent[]>()
  const roots: WebAgent[] = []
  for (const agent of state.agents) {
    const parent = parents.get(agent.id) ?? null
    if (parent === null) roots.push(agent)
    else kids.set(parent, [...(kids.get(parent) ?? []), agent])
  }
  roots.sort(order)
  for (const list of kids.values()) list.sort(order)
  const out: { agent: WebAgent; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (agent: WebAgent, depth: number) => {
    if (seen.has(agent.id)) return
    seen.add(agent.id)
    out.push({ agent, depth })
    for (const kid of kids.get(agent.id) ?? []) walk(kid, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  // a cycle the parents make leaves its agents unwalked: they stand at the top
  for (const agent of state.agents) walk(agent, 0)
  return out
}

/** The agents as the org chart's Client takes them (its props' `agents`, ./orgLayout's OrgAgent): in tree order, the tokens worded ('' for none), each parent one of the agents or null. */
export function chartAgentsOf(state: WebState): OrgAgent[] {
  const parents = parentsOf(state)
  return treeOf(state).map(({ agent }) => {
    const tokens = tokensOf(agent)
    return {
      id: agent.id,
      label: agent.label,
      type: agent.type,
      model: agent.model,
      tokens: tokens > 0 ? num(tokens) : '',
      status: agent.status,
      now: nowLine(agent),
      parent: parents.get(agent.id) ?? null,
    }
  })
}

// What waits on you (`pending`).

/** Questions first (the deck may answer them), then permissions; the oldest first in each. */
export function pendingOf(state: WebState): WebPending[] {
  const rank = (p: WebPending) => (p.kind === 'question' ? 0 : 1)
  return [...state.pending].sort((x, y) => rank(x) - rank(y) || (x.at || 0) - (y.at || 0))
}

const EDITS = new Set(['Edit', 'MultiEdit', 'NotebookEdit'])

/** What a permission is for: to "run" a command, "edit" a path, "use WebFetch"; and the command or path. */
export function permitOf(p: WebPending): { verb: string; what: string } {
  if (p.command) return { verb: 'run', what: p.command }
  if (p.path) return { verb: EDITS.has(p.tool) ? 'edit' : p.tool === 'Write' ? 'write' : p.tool === 'Read' ? 'read' : `use ${p.tool || 'a tool'} on`, what: p.path }
  return { verb: `use ${p.tool || 'a tool'}`, what: '' }
}

/** A question's questions, always a list. */
export function questionsOf(p: WebPending): NonNullable<WebPending['questions']> {
  return Array.isArray(p.questions) ? p.questions : []
}

/** Whether the deck may answer it: a question with questions, its race live in this mod. */
export function isAnswerable(p: WebPending): boolean {
  return p.isAnswerable === true && p.kind === 'question' && questionsOf(p).length > 0
}

/** One line for a pending item, a code span for its command or path: "Orchestrator asks: Which store?", "Tests needs your OK to run `npm test`". */
export function pendingText(p: WebPending, name: string): string {
  if (p.kind === 'question') {
    const qs = questionsOf(p)
    return qs.length > 1 ? `${name} asks ${qs.length} questions` : `${name} asks: ${qs[0]?.question ?? 'a question'}`
  }
  const { verb, what } = permitOf(p)
  const shown = firstLine(what)
  return `${name} needs your OK to ${verb}${shown ? ` ${shown.includes('`') ? shown : `\`${cut(shown, 90)}\``}` : ''}`
}

// The goal.

/** Where `lead` ends in `text`, a run of white space in either matching any in the other; -1 when the text does not start with it. */
function endOfLead(text: string, lead: string): number {
  let i = 0
  for (let j = 0; j < lead.length; j++) {
    if (/\s/.test(lead[j] ?? '')) {
      if (!/\s/.test(text[i] ?? '')) return -1
      while (i < text.length && /\s/.test(text[i] ?? '')) i++
      while (j + 1 < lead.length && /\s/.test(lead[j + 1] ?? '')) j++
    } else if (text[i++] !== lead[j]) return -1
  }
  return i
}

/**
 * The goal's words after its headline, so nothing reads twice: the headline
 * is the text's first line, or its first 80 characters cut with "…", and the
 * rest starts at the word the cut fell in. A headline of other words (a
 * slash command's) leaves the text whole.
 */
export function goalRest(goal: NonNullable<WebState['goal']>): string {
  const text = String(goal.text || '').trim()
  const head = String(goal.headline || '').trim()
  if (!head) return text
  const isCut = head.endsWith('…')
  let at = endOfLead(text, isCut ? head.slice(0, -1).trimEnd() : head)
  if (at < 0) return text
  if (isCut) while (at > 0 && /\S/.test(text[at - 1] ?? '') && /\S/.test(text[at] ?? '')) at--
  return text.slice(at).replace(/^[\s.:;,!?-]+/, '')
}

/** The plan's place: "Step 2 of 5" and the step in hand; with none in hand, the steps done; null without a plan. */
export function stepLineOf(state: WebState): { lead: string; text: string } | null {
  const steps = state.plan.steps
  if (steps.length === 0) return null
  const done = steps.filter(step => step.status === 'done').length
  const lead = state.summary.step ? `Step ${state.summary.step}` : done === steps.length ? 'Plan done' : `${done} of ${steps.length} done`
  return { lead, text: flat(state.summary.stepText ?? '') }
}

// The KPI strip.

/** How many agents are in each state, as their cards and pills show it. */
export function countsOf(agents: readonly WebAgent[]): { running: number; waiting: number; done: number; failed: number; idle: number } {
  const c = { running: 0, waiting: 0, done: 0, failed: 0, idle: 0 }
  for (const agent of agents) {
    if (isRunning(agent.status)) c.running++
    else if (agent.status in c) c[agent.status as 'waiting' | 'done' | 'failed' | 'idle']++
  }
  return c
}

/** One KPI box: its figure, what it counts, and one line under it (code spans in backticks). */
export type Kpi = { key: string; value: string; label: string; desc: string }

/** Agents running, plan steps, session spend, waiting on you: the page's four figures. */
export function kpisOf(state: WebState): Kpi[] {
  const s = state.summary
  const steps = state.plan.steps
  const done = steps.filter(step => step.status === 'done').length
  const c = countsOf(state.agents)
  const waiting = new Set([...state.pending.map(p => p.agentId), ...state.agents.filter(agent => agent.status === 'waiting').map(agent => agent.id)])
  const first = pendingOf(state)[0]
  const waiter = first ? undefined : (state.agents.find(agent => agent.needsYou) ?? state.agents.find(agent => agent.status === 'waiting'))
  const parts: string[] = []
  if (s.tokens) parts.push(`${num(s.tokens)} tokens`)
  if (s.minutes !== null && s.minutes !== undefined) parts.push(s.minutes < 1 ? '<1 min' : `${s.minutes} min`)
  if (s.contextPercent !== null && s.contextPercent !== undefined) parts.push(`context ${Math.round(s.contextPercent)}%`)
  const stepLine = steps.length === 0 ? 'No plan yet' : s.stepText ? `Now: ${flat(s.stepText)}` : done === steps.length ? 'All steps done' : 'No step in progress'
  const waitLine = first
    ? pendingText(first, nameOf(state, first.agentId))
    : waiter
      ? waiter.needsYou
        ? `${waiter.label} ${waiter.needsYou}`
        : `${waiter.label}: ${waiter.now || 'waiting'}`
      : 'Nothing waits on you'
  return [
    { key: 'running', value: String(c.running), label: 'Agents running', desc: `${c.waiting} waiting · ${c.done} done · ${c.failed} failed` },
    { key: 'plan', value: steps.length ? `${done}/${steps.length}` : '—', label: 'Plan steps', desc: stepLine },
    { key: 'spend', value: usd(s.costUsd), label: 'Session spend', desc: parts.join(' · ') || '—' },
    { key: 'waiting', value: String(Math.max(waiting.size, s.waiting || 0)), label: 'Waiting on you', desc: waitLine },
  ]
}

// Recent activity.

/** What a call did, as the page says it after the agent's name; a task-board call's target is its task, a question's its first question. */
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
  TodoWrite: 'updated its checklist',
  TaskCreate: 'added the step',
  TaskUpdate: 'updated',
  TaskGet: 'read',
  TaskList: 'read',
  ToolSearch: 'loaded',
  Skill: 'used',
  AskUserQuestion: 'asked you:',
}

/** The tools whose target is a path or a command: drawn as code. */
export const PATHY: ReadonlySet<string> = new Set(['Read', 'Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Glob', 'Grep', 'Bash', 'PowerShell'])

/** What a call did, as the page says it: "edited", "ran", "asked you:"; for a tool it has no word for, "used <tool> on" ("used an MCP tool on"), "on" left out with no target. */
export function verbOf(tool: string, hasTarget: boolean): string {
  return TOOL_VERB[tool] ?? `used ${tool.startsWith('mcp__') ? 'an MCP tool' : tool}${hasTarget ? ' on' : ''}`
}

/** How a call stands, beside its row: running, waiting on you, failed, or how long it took; and the mark before the word, as the agent page's Activity draws it ('' for none). */
export type Outcome = { text: string; tone: 'live' | 'wait' | 'fail' | 'quiet'; mark: string }

/** One row of Recent activity: who, what it did to what, how it went, when. */
export type ActivityRow = { key: string; agent: string; name: string; avatar: number | null; verb: string; target: string; isCode: boolean; outcome: Outcome; at: number }

function outcomeOf(state: WebState, x: WebState['activity'][number]): Outcome {
  if (x.ok === null || x.ok === undefined) {
    const agent = agentOf(state, x.agent)
    if (agent?.status === 'waiting') return { text: 'waiting', tone: 'wait', mark: '◐' }
    if (agent && !isLive(agent.status)) return { text: '—', tone: 'quiet', mark: '' }
    return { text: 'running', tone: 'live', mark: '◐' }
  }
  if (x.ok === false) return { text: 'failed', tone: 'fail', mark: '✕' }
  return { text: msText(x.ms) || 'ok', tone: 'quiet', mark: '' }
}

/** The newest `most` tool calls of every agent, newest first, each keyed by its time, agent and call so a row keeps its key as rows arrive. */
export function activityRows(state: WebState, most = 8): ActivityRow[] {
  const rows = state.activity.slice(-most).reverse()
  const seen = new Map<string, number>()
  return rows.map(x => {
    const agent = agentOf(state, x.agent)
    const base = `${x.at}:${x.agent}:${x.tool}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return {
      key: n === 0 ? base : `${base}:${n}`,
      agent: x.agent,
      name: agent ? agent.label : nameOf(state, x.agent),
      avatar: agent ? agent.avatar : null,
      verb: verbOf(x.tool, Boolean(x.target)),
      target: flat(x.target || ''),
      isCode: PATHY.has(x.tool),
      outcome: outcomeOf(state, x),
      at: x.at,
    }
  })
}

// Files.

/** A path as two paths are compared: forward slashes, no leading "./", one case (a Windows path's case says nothing). */
function pathKey(path: string): string {
  return String(path ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase()
}

/** One row of the Files panel: the file split into its folder and its name, who edited it (the newest editor apart), and whether the Changes tab lists it. */
export type FileRow = {
  path: string
  /** The folder with its trailing slash; '' for a file at the top. */
  dir: string
  name: string
  editors: string[]
  /** The agent that edited it last: whose Diffs a press opens where Changes does not list it. */
  editor: string
  live: boolean
  isShared: boolean
  added: number
  removed: number
  lastAt: number
  /** Changes lists it, so a press can open it there: one of git's uncommitted files in a repository; outside one, any file agents edited. */
  inChanges: boolean
  /** Outside the repository, as the state marks it (`isOutside`): a scratch or temp file. */
  isOutside: boolean
}

/** The files agents edited, the one edited last first (ties in the state's order), at most `most`: as the Files panel rows them. */
export function fileRows(state: WebState, most = 8): FileRow[] {
  const listed = state.repo ? new Set(state.changes.map(change => pathKey(change.path))) : null
  // who edited each file last, read once: the edits are oldest first
  const lastEditor = new Map<string, string>()
  for (const edit of state.edits) lastEditor.set(pathKey(edit.path), edit.agent)
  return state.files
    .map((file, i) => ({ file, i }))
    .sort((a, b) => (b.file.lastAt || 0) - (a.file.lastAt || 0) || a.i - b.i)
    .slice(0, Math.max(0, most))
    .map(({ file }) => {
      const key = pathKey(file.path)
      return {
        path: file.path,
        ...splitPath(file.path),
        editors: [...file.editors],
        editor: lastEditor.get(key) ?? file.editors[file.editors.length - 1] ?? '',
        live: file.live === true,
        isShared: file.isShared === true,
        added: file.added || 0,
        removed: file.removed || 0,
        lastAt: file.lastAt || 0,
        inChanges: listed === null || listed.has(key),
        isOutside: file.isOutside === true,
      }
    })
}

/** A path split at its last slash: its folder (with the slash; '' at the top) and its name. */
function splitPath(path: string): { dir: string; name: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return { dir: at >= 0 ? path.slice(0, at + 1) : '', name: at >= 0 ? path.slice(at + 1) : path }
}

/** A path outside the repository as the web's `shortPath` shows it: its last two parts after "…/" ("…/talk/msg2.txt"), one of two parts or fewer whole; split as a row shows it. */
export function shortPath(path: string): { dir: string; name: string } {
  const parts = String(path ?? '')
    .split(/[\\/]+/)
    .filter(part => part !== '')
  return splitPath(parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : String(path ?? ''))
}

/** The Files panel's rows as the web's FILES card groups them: the repository's own files, and apart from them those outside it (`isOutside`: mostly scratch and temp files). */
export type FileGroups = {
  /** The repository's files, the newest `most`; with no repository, every file agents edited. */
  inside: FileRow[]
  /** How many the repository's are: the state's `filesInRepo`, else the rows without `isOutside`. */
  insideCount: number
  /** Every file outside the repository, the one edited last first, its path shortened to its last two parts; none with no repository. */
  outside: FileRow[]
}

/** The files agents edited, as the Files panel groups them: the repository's own first, those the state marks `isOutside` apart (none with no repository); each the one edited last first. */
export function fileGroupsOf(state: WebState, most = 10): FileGroups {
  const all = fileRows(state, Number.POSITIVE_INFINITY)
  const inside = all.filter(row => !row.isOutside)
  const filesInRepo = state.summary.filesInRepo
  return {
    inside: inside.slice(0, Math.max(0, most)),
    insideCount: typeof filesInRepo === 'number' ? filesInRepo : inside.length,
    outside: all.filter(row => row.isOutside).map(row => ({ ...row, ...shortPath(row.path) })),
  }
}

/**
 * A row's path fitted to `room` cells (a character each, or as `advance`
 * has them): the name whole where it fits,
 * its folder cut from the start ("…/stores/") to make room; a name too long
 * on its own cut at its end, with no folder.
 */
export function fitPath(dir: string, name: string, room: number, advance: Advance = monoAdvance): { dir: string; name: string } {
  const nameCells = cellsOf(name, advance)
  const dirChars = Array.from(dir)
  const dots = advance('…')
  if (cellsOf(dir, advance) + nameCells <= room) return { dir, name }
  if (nameCells >= room - dots) return { dir: '', name: cutCells(name, Math.max(2, room), advance) }
  // the folder's tail that fits beside the name, after a "…"
  let keep = 0
  let used = nameCells + dots
  while (keep < dirChars.length && used + advance(dirChars[dirChars.length - 1 - keep] ?? '') <= room) used += advance(dirChars[dirChars.length - 1 - keep++] ?? '')
  return { dir: keep > 0 ? `…${dirChars.slice(dirChars.length - keep).join('')}` : '', name }
}
