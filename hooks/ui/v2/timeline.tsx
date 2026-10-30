/**
 * Org's Timeline in the pane: a row an
 * agent, from ../../timeline's `V2Timeline` (the live deck's, or the
 * sample's timeline.json), laid out by web/timeline.mjs as the web page lays
 * its own.
 *
 * - Each agent a row: its face, its name (a plain Button that opens its
 *   page), its status word, and on a line under them what it is doing now or
 *   did last; a press on any of it, its face and its lane too, opens its page
 *   (a veil over the row on a desktop, ./parts; on the terminal its face,
 *   name and word one Button, its lane and its line each another). Its lane sits beside it, every lane on one axis: its tool calls
 *   as segments named where the name fits, a failed one red, its waits on
 *   you amber, thinking a thin line between them, idle a dotted one, its end
 *   a cap (a green check done, a red cross failed, a grey square stopped),
 *   your prompts a white diamond on the Orchestrator's. The background tasks
 *   a loop started sit under its row, titled by what they are for, each a
 *   grey bar from its call to its end (or to now).
 * - The axis folds every stretch of 20 minutes or more where nobody worked
 *   to a break that says how long it was ("⋯ 2h 50m"), so the work gets the
 *   width.
 * - Messages between agents are numbered arrow marks between the lanes;
 *   their words are listed under the chart (time, who to whom, the words),
 *   after a legend of only what the chart holds.
 * - On the desktop each lane is a small Svg (an image) beside its row's own
 *   elements, made once per lane and minute (`laneSvg`); on the terminal the
 *   same rows in cells: a call a run of cells on its colour with the tool's
 *   name where it fits, `─` thinking, `┄` idle, `╱` a folded stretch, `↑↓` a
 *   message, `✓` done.
 * - The Orchestrator and the newest agents to start, 20 at most ("and n
 *   more"); the web page draws them all.
 *
 * Pure: Kit, the state, the timeline and DashActions come from the hooks
 * module.
 */
import type { RenderElement } from 'claude-code'

import * as Lanes from '../../../web/timeline.mjs'
import { hash } from '../../format'
import type { V2BackgroundLane, V2Lane, V2Timeline } from '../../timeline'
import { agentKeyOf, type V2AgentRow, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { listBox, listRow } from './dash'
import { agoText, quoted } from './dashModel'
import { avatar, avatarCells, quiet, svgOf } from './look'
import { P, toneOf } from './palette'
import { CELL_PX, isRowButton, rule, veil } from './parts'
import { ago, cellsOf, cutCells, flat, monoAdvance, plural, uiAdvance, type Advance } from './text'

/** The lanes the pane draws at most: the Orchestrator and the newest to start; past them, "and n more" (the web page draws them all). */
export const MOST_LANES = 20

/** The messages listed under the chart at most: the newest. */
export const MOST_MESSAGES = 12

/** The colours the timeline draws in, the web page's (web/app.css `.tl-*`). */
export const TL = {
  call: P.run,
  think: '#1f3b6e',
  wait: P.wait,
  fail: P.fail,
  done: P.done,
  stopped: P.idle,
  idle: P.muted3,
  grid: '#262626',
  fold: '#202020',
  hatch: '#6a6a6a',
  label: '#ffffff',
  axis: P.muted2,
  foldWords: P.muted,
  now: P.runText,
  you: P.text,
  message: P.fg2,
  pass: '#5a5a5a',
  background: '#64748b',
  backgroundEnd: P.idle,
} as const

/** The terminal's: a call's cells on a deep blue (red failed, amber waiting on you), the tool's name in white over them. */
export const TL_CELLS = {
  call: '#1d4ed8',
  fail: '#991b1b',
  wait: '#b45309',
  think: '#2f5ea8',
  idle: P.muted2,
  fold: '#5a5a5a',
  mark: P.text,
  pass: P.muted2,
} as const

/**
 * How long the axis runs, ms: from its start to now, a minute at least; a
 * run of an hour or more to its whole minute (so a still lane's image is
 * made again once a minute at most), a shorter one to its ten seconds, or
 * second.
 */
export function axisSpanOf(timeline: Pick<V2Timeline, 'now' | 'startedAt'>): number {
  const span = Math.max(60_000, timeline.now - timeline.startedAt)
  const step = span >= 3_600_000 ? 60_000 : span >= 600_000 ? 10_000 : 1000
  return Math.max(60_000, Math.floor(span / step) * step)
}

/** "3h 51m · 4 agents · 2 in the background · 4 messages": how long the timeline runs, its lanes, its background tasks and the messages it draws. */
export function timelineSummaryOf(timeline: V2Timeline, messages = timeline.messages.length): string {
  const span = axisSpanOf(timeline)
  const parts = [span < 60_000 ? '<1m' : Lanes.lengthOf(span), plural(timeline.lanes.length, 'agent')]
  if (timeline.background.length > 0) parts.push(`${timeline.background.length} in the background`)
  if (messages > 0) parts.push(plural(messages, 'message'))
  return parts.join(' · ')
}

/** "2h 50m idle, folded": how long nobody worked, in every fold; '' with none. */
export function foldSummaryOf(folds: readonly { from: number; to: number }[]): string {
  if (folds.length === 0) return ''
  return `${Lanes.lengthOf(folds.reduce((sum, one) => sum + (one.to - one.from), 0))} idle, folded`
}

/** The timeline as Org lays it out: its lanes drawn (the newest `most`), its rows (each lane, the background tasks under the lane that started them), the axis's span and folds, and the messages drawn, numbered. */
export type TimelineLayout = {
  timeline: V2Timeline
  lanes: V2Lane[]
  more: number
  rows: Lanes.Row<V2Lane, V2BackgroundLane>[]
  span: number
  folds: { from: number; to: number }[]
  crossings: Lanes.Crossing[][]
  messages: (V2Timeline['messages'][number] & { n: number })[]
}

/** A row's id among the rows: its lane's, or `bg:` and its task's. */
function rowIdOf(row: Lanes.Row<V2Lane, V2BackgroundLane>): string {
  return row.kind === 'lane' ? row.lane.id : `bg:${row.bg.id}`
}

/** How Org lays `timeline` out, `most` lanes at most: the folds where nobody worked, every lane counted. */
export function layoutOf(timeline: V2Timeline, most = MOST_LANES): TimelineLayout {
  const { lanes, more } = Lanes.newestOf(timeline.lanes, most)
  const rows = Lanes.rowsOf(lanes, timeline.background)
  const span = axisSpanOf(timeline)
  const ids = rows.map(rowIdOf)
  return {
    timeline,
    lanes,
    more,
    rows,
    span,
    folds: Lanes.foldsOf(timeline.lanes, span),
    crossings: Lanes.crossingsOf(ids, timeline.messages),
    messages: Lanes.numberedOf(ids, timeline.messages),
  }
}

/** A lane's calls as web/timeline.mjs takes them. */
function callsOf(timeline: V2Timeline, lane: V2Lane): Lanes.Call[] {
  return lane.ticks.map(tick => ({ at: tick[0], ms: tick[1], tool: timeline.tools[tick[2]] ?? '', how: tick[3] }))
}

/** Whether a lane runs to now: a stretch of work with no end. */
function isLive(lane: V2Lane): boolean {
  return lane.spans.some(one => one.kind === 'work' && one.to === null)
}

/** Whether a lane (or a task) lived across a fold: it began before it and had not ended when it ended. */
function livedAcross(start: number, end: number | null, fold: { from: number; to: number }): boolean {
  return start <= fold.from && (end === null || end >= fold.to)
}

// What a row says beside its lane.

/** A status as a row's word says it, in its hue: "running", "waiting", "done", "failed", "idle"; "stopped" for one stopped. */
function wordOf(lane: Pick<V2Lane, 'status' | 'isStopped'>): { word: string; hue: string } {
  if (lane.isStopped) return { word: 'stopped', hue: P.idle }
  const tone = toneOf(lane.status)
  return { word: tone.word, hue: tone.pillFg }
}

/**
 * What a row's second line says, what its agent is doing now or did last:
 * waiting on you (and on what); how its run ended and what it handed back
 * ("Done 9m ago: “…”"); its call in flight ("Bash npm test · running 2m");
 * its words since; else its newest call ("Read src/app.ts · 4m ago");
 * else what it last handed back. Its words' code spans lose their
 * backticks: a line of plain text draws them.
 */
export function nowLineOf(row: V2AgentRow | undefined, lane: V2Lane, timeline: V2Timeline): string {
  return nowWordsOf(row, lane, timeline).replace(/`([^`\n]+)`/g, '$1')
}

function nowWordsOf(row: V2AgentRow | undefined, lane: V2Lane, timeline: V2Timeline): string {
  const now = timeline.now
  const live = row?.live ? flat(`${row.live.tool} ${row.live.text}`) : ''
  if (lane.status === 'waiting') return live ? `Waiting on you: ${live}` : 'Waiting on you'
  const ended = lane.isStopped ? 'Stopped' : lane.status === 'done' ? 'Done' : lane.status === 'failed' ? 'Failed' : ''
  if (ended) {
    const when = agoText(lane.end !== null ? timeline.startedAt + lane.end : (row?.endedAt ?? now), now)
    return row?.result ? `${ended} ${when}: ${quoted(row.result)}` : `${ended} ${when}`
  }
  if (row?.live) {
    const age = ago(row.live.at, now)
    return `${live} · ${age === 'now' ? 'now' : `running ${age}`}`
  }
  if (row?.said) return quoted(row.said.text)
  const last = lane.ticks[lane.ticks.length - 1]
  if (last) return `${flat([timeline.tools[last[2]] ?? '', last[4] ?? ''].join(' '))} · ${agoText(timeline.startedAt + last[0], now)}`
  return row?.result ? quoted(row.result) : ''
}

// The desktop: each lane a small image.

/** A number for an SVG attribute: a tenth of a px at most. */
function n1(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/** Words for an SVG document, its markup characters escaped. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)
}

/** The px words take at `size` px in the desktop's face (its cell is 7.85 px at 13 px). */
function textPx(text: string, size: number): number {
  return (cellsOf(text, uiAdvance) * CELL_PX * size) / 13
}

const FONT = 'Anthropic Sans, anthropic-sans, system-ui, -apple-system, Segoe UI, sans-serif'

/** An SVG document `w` × `h` of `parts`. */
function svgDoc(w: number, h: number, parts: readonly string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">${parts.join('')}</svg>`
}

/** The room a lane's image leaves its axis: 4 px before it, 10 after it (an end's cap, the now line). */
const PAD_LEFT = 4
const PAD_RIGHT = 10

/** A row's image heights, px: an agent's two lines, a background task's one, the axis's. */
const ROW_PX = { lane: 38, bg: 18, axis: 18 } as const

/** The gridlines and the folds' ground under a row `h` high, a fold's break hatched where the row lived across it. */
function groundOf(axis: Lanes.Axis, grid: readonly number[], h: number, lived: (fold: { from: number; to: number }) => boolean): string[] {
  const out: string[] = []
  if (grid.length > 0) out.push(`<path d="${grid.map(x => `M${n1(x)} 0V${h}`).join('')}" stroke="${TL.grid}"/>`)
  const mid = h / 2
  for (const one of axis.folds) {
    out.push(`<rect x="${n1(one.x0 + 1)}" y="0" width="${n1(Math.max(1, one.x1 - one.x0 - 2))}" height="${h}" fill="${TL.fold}"/>`)
    const cx = (one.x0 + one.x1) / 2
    if (lived(one)) out.push(`<path d="M${n1(cx - 5)} ${n1(mid + 5)}l4 -10M${n1(cx + 1)} ${n1(mid + 5)}l4 -10" stroke="${TL.hatch}" stroke-width="1.3" fill="none"/>`)
  }
  return out
}

/** The messages' marks on a row `h` high: out of the sender's lane toward the receiver's row (its number beside it), into the receiver's, a dashed line through the rows between. */
function marksOf(axis: Lanes.Axis, crossings: readonly Lanes.Crossing[], h: number): string[] {
  const out: string[] = []
  const mid = h / 2
  for (const one of crossings) {
    const x = n1(axis.x(one.at))
    if (one.role === 'pass') {
      out.push(`<path d="M${x} 0V${h}" stroke="${TL.pass}" stroke-dasharray="2 2"/>`)
      continue
    }
    const edge = (one.role === 'from') === one.down ? h : 0
    const bar = (one.role === 'from') === one.down ? mid + 7 : mid - 7
    const [y1, y2] = one.role === 'from' ? [bar, edge] : [edge, bar]
    const dir = y2 > y1 ? 1 : -1
    out.push(`<path d="M${x} ${n1(y1)}V${n1(y2 - dir * 3)}" stroke="${TL.message}" stroke-width="1.4"/><path d="M${x} ${n1(y2)}l-3.2 ${n1(-dir * 4.5)}h6.4z" fill="${TL.message}"/>`)
    if (one.role === 'from') out.push(`<text x="${n1(axis.x(one.at) + 4)}" y="${n1(one.down ? h - 2 : 9)}" font-size="9.5" font-weight="600" fill="${TL.message}">${one.n}</text>`)
  }
  return out
}

/** A lane's image `w` × `h`: its ground, idle dotted, thinking a thin bar, its calls as segments (named where the name fits), its waits on you, your prompts, its end's cap, the messages' marks, now. */
function laneSvg(timeline: V2Timeline, lane: V2Lane, axis: Lanes.Axis, grid: readonly number[], crossings: readonly Lanes.Crossing[], w: number, h: number): string {
  const mid = h / 2
  const out = groundOf(axis, grid, h, fold => livedAcross(lane.start, lane.end, fold))
  const to = (at: number | null) => axis.x(at ?? axis.span)
  const idle = lane.spans.filter(one => one.kind === 'idle').map(one => `M${n1(axis.x(one.from) + 2)} ${mid}H${n1(Math.max(axis.x(one.from) + 2, to(one.to) - 2))}`)
  if (idle.length > 0) out.push(`<path d="${idle.join('')}" stroke="${TL.idle}" stroke-width="2" stroke-dasharray="2 3" fill="none"/>`)
  const bar = (a: number, b: number, half: number) => `M${n1(a)} ${n1(mid - half)}h${n1(Math.max(2, b - a))}v${half * 2}h${n1(-Math.max(2, b - a))}z`
  const work = lane.spans.filter(one => one.kind === 'work').map(one => bar(axis.x(one.from), to(one.to), 3))
  if (work.length > 0) out.push(`<path d="${work.join('')}" fill="${TL.think}"/>`)
  const segments = Lanes.segmentsOf(callsOf(timeline, lane), axis, { liveTo: isLive(lane) ? axis.span : null, min: 2.5, join: 2 })
  const ok: string[] = []
  const bad: string[] = []
  const words: string[] = []
  for (const one of segments) {
    // a failed call is a thin red mark where it is short: a few among many never paint a lane red
    const width = one.failed ? Math.max(1.5, axis.x(one.to) - one.x0) : one.x1 - one.x0 > 4 ? one.x1 - one.x0 - 1 : one.x1 - one.x0
    ;(one.failed ? bad : ok).push(bar(one.x0, one.x0 + width, 6))
    const label = Lanes.segmentLabel(one, width, text => textPx(text, 10), false, 6)
    if (label) words.push(`<text x="${n1(one.x0 + width / 2)}" y="${n1(mid + 3.6)}" text-anchor="middle" font-size="10" font-weight="500" fill="${TL.label}">${esc(label)}</text>`)
  }
  if (ok.length > 0) out.push(`<path d="${ok.join('')}" fill="${TL.call}"/>`)
  if (bad.length > 0) out.push(`<path d="${bad.join('')}" fill="${TL.fail}"/>`)
  const waits = lane.spans.filter(one => one.kind === 'wait').map(one => bar(axis.x(one.from), to(one.to), 6))
  if (waits.length > 0) out.push(`<path d="${waits.join('')}" fill="${TL.wait}"/>`)
  out.push(...words)
  if (lane.id === 'main' && timeline.marks.length > 0) out.push(`<path d="${timeline.marks.map(one => `M${n1(axis.x(one.at))} ${mid - 11}l4 4-4 4-4-4z`).join('')}" fill="${TL.you}"/>`)
  if (lane.end !== null && lane.outcome !== null) {
    const x = Math.min(axis.room + PAD_RIGHT - 7, axis.x(lane.end) + 2)
    if (lane.outcome === 'done') out.push(`<circle cx="${n1(x)}" cy="${mid}" r="6.5" fill="${TL.done}"/><path d="M${n1(x - 3)} ${mid}l2.2 2.2 4-4.4" stroke="#052e16" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
    else if (lane.outcome === 'failed') out.push(`<circle cx="${n1(x)}" cy="${mid}" r="6.5" fill="${TL.fail}"/><path d="M${n1(x - 2.5)} ${mid - 2.5}l5 5m0 -5l-5 5" stroke="#450a0a" stroke-width="1.8" stroke-linecap="round"/>`)
    else out.push(`<rect x="${n1(x - 4.5)}" y="${mid - 4.5}" width="9" height="9" rx="1.5" fill="${TL.stopped}"/>`)
  }
  out.push(...marksOf(axis, crossings, h))
  out.push(`<path d="M${n1(axis.room)} 0V${h}" stroke="${TL.now}" stroke-dasharray="3 3"/>`)
  return svgDoc(w, h, [`<g transform="translate(${PAD_LEFT} 0)">`, ...out, '</g>'])
}

/** A background task's image: its ground, a grey bar from its call to its end (a cap there) or to now, the messages' lines through it. */
function backgroundSvg(bg: V2BackgroundLane, axis: Lanes.Axis, grid: readonly number[], crossings: readonly Lanes.Crossing[], w: number, h: number): string {
  const mid = h / 2
  const out = groundOf(axis, grid, h, fold => livedAcross(bg.start, bg.end, fold))
  const a = axis.x(bg.start)
  const b = axis.x(bg.end ?? axis.span)
  out.push(`<rect x="${n1(a)}" y="${mid - 3}" width="${n1(Math.max(3, b - a))}" height="6" rx="3" fill="${TL.background}"/>`)
  if (bg.end !== null) out.push(`<rect x="${n1(Math.max(a, b - 3))}" y="${mid - 4}" width="6" height="8" rx="1.5" fill="${TL.backgroundEnd}"/>`)
  out.push(...marksOf(axis, crossings, h))
  out.push(`<path d="M${n1(axis.room)} 0V${h}" stroke="${TL.now}" stroke-dasharray="3 3"/>`)
  return svgDoc(w, h, [`<g transform="translate(${PAD_LEFT} 0)">`, ...out, '</g>'])
}

/** The axis over the lanes: its words (`Lanes.axisWordsOf`), a fold's in a lighter grey, "now" in blue. */
function axisSvg(words: readonly Lanes.AxisWord[], w: number, h: number): string {
  const anchor = { start: 'start', middle: 'middle', end: 'end' } as const
  const out = words.map(word => {
    const fill = word.kind === 'now' ? TL.now : word.kind === 'fold' ? TL.foldWords : TL.axis
    return `<text x="${n1(word.x)}" y="${h - 5}" fill="${fill}" font-size="${word.kind === 'fold' ? 10 : 11}" text-anchor="${anchor[word.align]}">${esc(word.text)}</text>`
  })
  return svgDoc(w, h, [`<g transform="translate(${PAD_LEFT} 0)">`, ...out, '</g>'])
}

/** The images made, by lane and what they draw (the axis's span to the minute on a long run): a redraw of the same state, or a still lane within its minute, makes none again. */
const made = new Map<string, string>()

/** `make()` once per `key` (the newest 400 kept). */
function memo(key: string, make: () => string): string {
  const known = made.get(key)
  if (known !== undefined) return known
  const svg = make()
  if (made.size >= 400) made.delete(made.keys().next().value as string)
  made.set(key, svg)
  return svg
}

/** What the legend shows: only what the chart holds. */
type LegendKey = 'call' | 'think' | 'fail' | 'wait' | 'done' | 'stopped' | 'idle' | 'message' | 'you' | 'background' | 'fold'

const LEGEND_WORDS: Readonly<Record<LegendKey, string>> = {
  call: 'a tool call (named where it fits)',
  think: 'thinking',
  fail: 'failed',
  wait: 'waiting on you',
  done: 'done',
  stopped: 'stopped',
  idle: 'idle',
  message: 'a message',
  you: 'you wrote',
  background: 'in the background',
  fold: 'idle, folded',
}

/** The legend's keys, in order: only what the chart holds. */
export function legendOf(layout: TimelineLayout): LegendKey[] {
  const { timeline, lanes } = layout
  const has = (kind: string) => lanes.some(lane => lane.spans.some(one => one.kind === kind))
  const keys: [LegendKey, boolean][] = [
    ['call', lanes.some(lane => lane.ticks.length > 0)],
    ['think', has('work')],
    ['fail', lanes.some(lane => lane.outcome === 'failed' || lane.ticks.some(tick => tick[3] === 0))],
    ['wait', has('wait')],
    ['done', lanes.some(lane => lane.outcome === 'done')],
    ['stopped', lanes.some(lane => lane.outcome === 'stopped')],
    ['idle', has('idle')],
    ['message', layout.messages.length > 0],
    ['you', timeline.marks.length > 0 && lanes.some(lane => lane.id === 'main')],
    ['background', layout.rows.some(row => row.kind === 'bg')],
    ['fold', layout.folds.length > 0],
  ]
  return keys.flatMap(([key, isShown]) => (isShown ? [key] : []))
}

/** The legend as one image `w` across, its keys wrapped to the width. */
function legendSvg(keys: readonly LegendKey[], w: number): { svg: string; height: number } {
  const out: string[] = []
  let x = 0
  let y = 12
  for (const key of keys) {
    const label = LEGEND_WORDS[key]
    const width = 19 + textPx(label, 11) + 16
    if (x > 0 && x + width > w) {
      x = 0
      y += 18
    }
    const swatch: Readonly<Record<LegendKey, string>> = {
      call: `<rect x="${n1(x)}" y="${y - 9}" width="14" height="10" rx="2" fill="${TL.call}"/>`,
      think: `<rect x="${n1(x)}" y="${y - 7}" width="14" height="6" rx="3" fill="${TL.think}"/>`,
      fail: `<rect x="${n1(x)}" y="${y - 9}" width="14" height="10" rx="2" fill="${TL.fail}"/>`,
      wait: `<rect x="${n1(x)}" y="${y - 9}" width="14" height="10" rx="2" fill="${TL.wait}"/>`,
      done: `<circle cx="${n1(x + 7)}" cy="${y - 4}" r="5.5" fill="${TL.done}"/><path d="M${n1(x + 4.3)} ${y - 4}l2 2 3.6-4" stroke="#052e16" stroke-width="1.6" fill="none"/>`,
      stopped: `<rect x="${n1(x + 2.5)}" y="${y - 8.5}" width="9" height="9" rx="1.5" fill="${TL.stopped}"/>`,
      idle: `<path d="M${n1(x)} ${y - 4}h14" stroke="${TL.idle}" stroke-width="2" stroke-dasharray="2 3"/>`,
      message: `<path d="M${n1(x + 7)} ${y - 11}V${y - 2}" stroke="${TL.message}" stroke-width="1.4"/><path d="M${n1(x + 7)} ${y + 1}l-3 -4h6z" fill="${TL.message}"/>`,
      you: `<path d="M${n1(x + 7)} ${y - 9}l4 4-4 4-4-4z" fill="${TL.you}"/>`,
      background: `<rect x="${n1(x)}" y="${y - 7}" width="14" height="6" rx="3" fill="${TL.background}"/>`,
      fold: `<rect x="${n1(x)}" y="${y - 11}" width="14" height="14" fill="${TL.fold}"/><path d="M${n1(x + 3)} ${y + 1}l3 -10M${n1(x + 8)} ${y + 1}l3 -10" stroke="${TL.hatch}" stroke-width="1.2"/>`,
    }
    out.push(swatch[key], `<text x="${n1(x + 19)}" y="${y}" font-size="11" fill="${P.muted}">${esc(label)}</text>`)
    x += width
  }
  const height = y + 6
  return { svg: svgDoc(w, height, out), height }
}

// The terminal: each lane in cells.

/** One cell of a text lane: its glyph, its colour, and the colour under it. */
export type Cell = { ch: string; color: string; bg?: string }

const BLANK: Cell = { ch: ' ', color: P.muted3 }

/** The cell `x` (a place on the axis) falls in, within `cells`. */
function cellAt(x: number, cells: number): number {
  return Math.min(cells - 1, Math.max(0, Math.floor(x)))
}

/** Paints the folds' breaks: `╱` where the row lived across one, else blank. */
function paintFolds(out: Cell[], axis: Lanes.Axis, lived: (fold: { from: number; to: number }) => boolean): void {
  for (const one of axis.folds) {
    const cell: Cell = lived(one) ? { ch: '╱', color: TL_CELLS.fold } : BLANK
    for (let i = cellAt(one.x0, out.length); i < Math.min(out.length, Math.max(cellAt(one.x0, out.length) + 1, Math.round(one.x1))); i++) out[i] = cell
  }
}

/** Paints the messages' marks: `↓` or `↑` (the way the message went) on its sender's and its receiver's rows, `┆` through the rows between where nothing else is. */
function paintMarks(out: Cell[], axis: Lanes.Axis, crossings: readonly Lanes.Crossing[]): void {
  for (const one of crossings) {
    const at = cellAt(axis.x(one.at), out.length)
    if (one.role !== 'pass') out[at] = { ch: one.down ? '↓' : '↑', color: TL_CELLS.mark }
    else if (out[at]?.ch === ' ' || out[at]?.ch === '┄') out[at] = { ch: '┆', color: TL_CELLS.pass }
  }
}

/**
 * A lane as cells over `axis` (its room the cells): idle `┄`, thinking `─`,
 * each segment of calls a run of cells on its colour with its tool's name in
 * white where it fits (`Lanes.segmentLabel`; a failed one too short `✕`), a wait on
 * you on amber ("you" where it fits), your prompts `◆` on the
 * Orchestrator's, its end's cap (`✓` done, `✕` failed, `■` stopped), the
 * folds `╱` where it lived across them, the messages `↑↓`.
 */
export function laneCellsOf(timeline: V2Timeline, lane: V2Lane, axis: Lanes.Axis, crossings: readonly Lanes.Crossing[] = []): Cell[] {
  const cells = Math.max(1, Math.round(axis.room))
  const out: Cell[] = Array.from({ length: cells }, () => BLANK)
  const at = (ms: number) => cellAt(axis.x(ms), cells)
  const until = (to: number | null) => (to === null ? cells - 1 : Math.max(0, Math.ceil(axis.x(to)) - 1))
  const fill = (a: number, b: number, cell: Cell, over: (one: Cell) => boolean = () => true) => {
    for (let i = a; i <= Math.min(b, cells - 1); i++) if (over(out[i] ?? BLANK)) out[i] = cell
  }
  for (const one of lane.spans) if (one.kind === 'idle') fill(at(one.from), until(one.to), { ch: '┄', color: TL_CELLS.idle })
  for (const one of lane.spans) if (one.kind === 'work') fill(at(one.from), Math.max(at(one.from), until(one.to)), { ch: '─', color: TL_CELLS.think })
  paintFolds(out, axis, fold => livedAcross(lane.start, lane.end, fold))
  const marked = new Set(crossings.filter(one => one.role !== 'pass').map(one => at(one.at)))
  const label = (a: number, b: number, word: string, bg: string) => {
    const clear = Array.from({ length: word.length }, (_, k) => a + k).every(i => !marked.has(i))
    if (b - a + 1 < word.length + 1 || !clear) return false
    Array.from(word).forEach((ch, k) => (out[a + k] = { ch, color: '#ffffff', bg }))
    return true
  }
  for (const one of Lanes.segmentsOf(callsOf(timeline, lane), axis, { liveTo: isLive(lane) ? axis.span : null, min: 1, join: 1 })) {
    const a = cellAt(one.x0, cells)
    const b = Math.max(a, Math.ceil(one.x1) - 1)
    const bg = one.failed ? TL_CELLS.fail : TL_CELLS.call
    fill(a, b, { ch: ' ', color: '#ffffff', bg })
    const word = Lanes.segmentLabel(one, b - a + 1, text => Array.from(text).length, false, 1)
    if (!(word && label(a, b, word, bg)) && one.failed) out[a] = { ch: '✕', color: '#ffffff', bg }
  }
  for (const one of lane.spans) {
    if (one.kind !== 'wait') continue
    const a = at(one.from)
    const b = Math.max(a, until(one.to))
    fill(a, b, { ch: ' ', color: '#ffffff', bg: TL_CELLS.wait })
    label(a, b, 'you', TL_CELLS.wait)
  }
  if (lane.id === 'main') for (const mark of timeline.marks) out[at(mark.at)] = { ch: '◆', color: TL.you }
  if (lane.end !== null && lane.outcome !== null) {
    // the cap in the cell after the lane's last, where there is one
    const last = until(lane.end)
    const cap = Math.min(cells - 1, last + 1)
    out[cap] = lane.outcome === 'done' ? { ch: '✓', color: TL.done } : lane.outcome === 'failed' ? { ch: '✕', color: TL.fail } : { ch: '■', color: TL.stopped }
  }
  paintMarks(out, axis, crossings)
  return out
}

/** A background task as cells: a grey `━` from its call to its end (`■` there) or to now, the folds it lived across `╱`, the messages' lines through it. */
export function backgroundCellsOf(bg: V2BackgroundLane, axis: Lanes.Axis, crossings: readonly Lanes.Crossing[] = []): Cell[] {
  const cells = Math.max(1, Math.round(axis.room))
  const out: Cell[] = Array.from({ length: cells }, () => BLANK)
  const a = cellAt(axis.x(bg.start), cells)
  const b = bg.end === null ? cells - 1 : Math.max(a, Math.ceil(axis.x(bg.end)) - 1)
  for (let i = a; i <= b; i++) out[i] = { ch: '━', color: TL.background }
  paintFolds(out, axis, fold => livedAcross(bg.start, bg.end, fold))
  if (bg.end !== null) out[b] = { ch: '■', color: TL.backgroundEnd }
  paintMarks(out, axis, crossings)
  return out
}

/** The axis as one line of cells: each fold's break `╱╱╱` (its length left to the summary), its words where they fit whole (`Lanes.axisWordsOf`), never over a break. */
export function axisLineOf(axis: Lanes.Axis, startedAt: number): string {
  const cells = Math.max(1, Math.round(axis.room))
  const line = new Array<string>(cells).fill(' ')
  for (const one of axis.folds) for (let i = cellAt(one.x0, cells); i < Math.min(cells, Math.max(cellAt(one.x0, cells) + 1, Math.round(one.x1))); i++) line[i] = '╱'
  const words = Lanes.axisWordsOf(axis, startedAt, text => text.length, 1, null)
  for (const word of words) {
    const left = Math.round(word.align === 'start' ? word.x : word.align === 'end' ? word.x - word.text.length : word.x - word.text.length / 2)
    const chars = Array.from(word.text)
    if (left < 0 || left + chars.length > cells || chars.some((_, k) => line[left + k] !== ' ')) continue
    chars.forEach((ch, k) => (line[left + k] = ch))
  }
  return line.join('')
}

/** Cells as runs of one colour on one ground. */
function runsOf(cells: readonly Cell[]): { text: string; color: string; bg?: string }[] {
  const out: { text: string; color: string; bg?: string }[] = []
  for (const cell of cells) {
    const last = out[out.length - 1]
    if (last && last.color === cell.color && last.bg === cell.bg) last.text += cell.ch
    else out.push({ text: cell.ch, color: cell.color, ...(cell.bg ? { bg: cell.bg } : {}) })
  }
  return out
}

/** The cells a box-drawing glyph takes off the terminal, in a desktop's face: about 1.17. */
const BOX_CELLS = 1.17

/** A row of cells: on the terminal one Text of coloured runs; where no Svg draws off it, a Box a run as wide as its cells' time, each run its glyph (a call's cells `━` in their colour). */
function cellsLine(kit: Kit, key: string, cells: readonly Cell[]): RenderElement {
  const { Box, Text } = kit
  if (kit.surface === 'terminal') {
    return (
      <Text key={key} wrap="truncate-end">
        {runsOf(cells).map((run, i) =>
          run.bg ? (
            <Text key={`r${i}`} color={run.color} backgroundColor={run.bg}>
              {run.text}
            </Text>
          ) : (
            <Text key={`r${i}`} color={run.color}>
              {run.text}
            </Text>
          ),
        )}
      </Text>
    )
  }
  const plain = runsOf(cells.map(cell => (cell.bg ? { ch: '━', color: cell.bg } : cell)))
  let glyphs = 0
  let used = 0
  return (
    <Box key={key} flexDirection="row">
      {plain.map((run, i) => {
        glyphs += run.text.length
        const end = Math.round(glyphs * BOX_CELLS)
        const width = end - used
        used = end
        const ch = run.text[0] ?? ' '
        return (
          <Box key={`r${i}`} width={width} flexShrink={0}>
            {ch === ' ' || width === 0 ? null : <Text color={run.color} wrap="truncate-end">{ch.repeat(Math.max(1, Math.floor(width / BOX_CELLS)))}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

// Org's Timeline.

/** The cells a row's words take beside its lane: about a third of the pane. */
function labelCells(kit: Kit): number {
  return kit.surface === 'terminal' ? Math.min(34, Math.max(18, Math.round(kit.columns * 0.34))) : Math.min(40, Math.max(22, Math.round(kit.columns * 0.36)))
}

/** The rows of the chart with Svg: the axis, then each lane's row and image, each background task's under its starter's. */
function svgRows(kit: Kit, layout: TimelineLayout, state: Pick<WebStateV2, 'agents'>, actions: DashActions): RenderElement[] {
  const { Box, Text, Button } = kit
  const Svg = svgOf(kit) as NonNullable<Kit['Svg']>
  const { timeline } = layout
  const label = labelCells(kit)
  const w = Math.max(160, Math.floor((kit.columns - label - 1) * CELL_PX))
  const axis = Lanes.axisOf(layout.span, layout.folds, w - PAD_LEFT - PAD_RIGHT, 46)
  const words = Lanes.axisWordsOf(axis, timeline.startedAt, text => textPx(text, 11), 8)
  const grid = words.filter(word => word.kind === 'tick').map(word => word.x)
  const axisKey = `${layout.span}|${axis.room}|${axis.folds.map(one => `${one.from}-${one.to}`).join(',')}|${grid.map(n1).join(',')}`
  const rowOf = new Map(state.agents.flatMap(row => (row.row === 'agent' ? [[row.id, row] as const] : [])))
  const advance = uiAdvance
  const out: RenderElement[] = [
    <Box key="tl:axis" flexDirection="row" columnGap={1}>
      <Box width={label} flexShrink={0} />
      <Box flexShrink={0}>
        <Svg source={memo(`axis|${axisKey}|${timeline.startedAt}`, () => axisSvg(words, w, ROW_PX.axis))} alt={axisAltOf(axis, words)} width={w} height={ROW_PX.axis} />
      </Box>
    </Box>,
  ]
  layout.rows.forEach((row, i) => {
    const crossings = layout.crossings[i] ?? []
    if (row.kind === 'bg') {
      const bg = row.bg
      const source = memo(`bg|${bg.id}|${w}|${axisKey}|${hash(JSON.stringify([bg, crossings]))}`, () => backgroundSvg(bg, axis, grid, crossings, w, ROW_PX.bg))
      out.push(
        <Box key={`tl:bg:${bg.id}`} flexDirection="row" columnGap={1} alignItems="center">
          <Box width={label} flexShrink={0} flexDirection="row" columnGap={1} paddingLeft={3}>
            <Text color={P.muted3}>└</Text>
            <Box flexShrink={1} minWidth={0}>
              <Text color={P.muted} wrap="truncate-end">
                {bg.title}
              </Text>
            </Box>
          </Box>
          <Box flexShrink={0}>
            <Svg source={source} alt={`${bg.what ? `${bg.what}: ` : ''}${bg.title}, ${bg.end === null ? 'running' : 'ended'}`} width={w} height={ROW_PX.bg} />
          </Box>
        </Box>,
      )
      return
    }
    const lane = row.lane
    const { word, hue } = wordOf(lane)
    const indent = Math.min(3, Math.max(0, lane.depth - 1)) * 2
    const source = memo(`lane|${lane.id}|${w}|${axisKey}|${hash(JSON.stringify([lane, crossings, lane.id === 'main' ? timeline.marks : []]))}`, () => laneSvg(timeline, lane, axis, grid, crossings, w, ROW_PX.lane))
    const now = nowLineOf(rowOf.get(lane.id), lane, timeline)
    out.push(
      <Box key={`tl:${lane.id}`} flexDirection="row" columnGap={1} alignItems="center">
        <Box width={label} flexShrink={0} flexDirection="column" paddingLeft={indent}>
          <Box flexDirection="row" columnGap={1} alignItems="center">
            <Box flexShrink={0}>{avatar(kit, lane, 18)}</Box>
            <Box flexShrink={1} minWidth={0} flexDirection="row">
              <Button key={agentKeyOf(lane.id)} label={lane.title} plain onPress={() => actions.openAgent(lane.id)} />
            </Box>
            <Box flexShrink={0}>
              <Text color={hue}>{word}</Text>
            </Box>
          </Box>
          <Box flexDirection="row" paddingLeft={3}>
            <Box flexShrink={1} minWidth={0}>
              <Text color={P.muted2} wrap="truncate-end">
                {now === '' ? ' ' : cutCells(now, Math.max(4, (label - indent - 3) * 2), advance)}
              </Text>
            </Box>
          </Box>
        </Box>
        <Box flexShrink={0}>
          <Svg source={source} alt={laneAltOf(timeline, lane)} width={w} height={ROW_PX.lane} />
        </Box>
        {veil(kit, agentKeyOf(lane.id), () => actions.openAgent(lane.id))}
      </Box>,
    )
  })
  return out
}

/** What the axis says to a reader that cannot see it: from its first time to now, each fold. */
function axisAltOf(axis: Lanes.Axis, words: readonly Lanes.AxisWord[]): string {
  const folds = axis.folds.map(one => `${Lanes.lengthOf(one.to - one.from)} idle folded`)
  return ['Time', ...words.filter(word => word.kind !== 'fold').map(word => word.text), ...folds].join(', ')
}

/** What a lane's image says to a reader that cannot see it: its calls, the failed ones, its waits on you, how it ended. */
function laneAltOf(timeline: V2Timeline, lane: V2Lane): string {
  const failed = lane.ticks.filter(tick => tick[3] === 0).length
  const waits = lane.spans.filter(one => one.kind === 'wait').length
  const parts = [`${lane.title}'s lane: ${plural(lane.ticks.length, 'tool call')}`]
  if (failed > 0) parts.push(`${failed} failed`)
  if (waits > 0) parts.push(`waited on you ${plural(waits, 'time')}`)
  if (lane.outcome) parts.push(lane.outcome)
  return parts.join(', ')
}

/** The rows of the chart in cells: the axis, then each lane's row (its face, its name a Button, its word, its cells) with what it does on the line under it, each background task under its starter's. */
function cellRows(kit: Kit, layout: TimelineLayout, state: Pick<WebStateV2, 'agents'>, actions: DashActions): RenderElement[] {
  const { Box, Text, Button } = kit
  const { timeline } = layout
  const isMono = kit.surface === 'terminal'
  const advance: Advance = isMono ? monoAdvance : uiAdvance
  const label = labelCells(kit)
  const room = Math.max(10, kit.columns - label - 1)
  const cells = isMono ? room : Math.floor(room / BOX_CELLS)
  const axis = Lanes.axisOf(layout.span, layout.folds, cells, 3)
  const rowOf = new Map(state.agents.flatMap(row => (row.row === 'agent' ? [[row.id, row] as const] : [])))
  const out: RenderElement[] = [
    <Box key="tl:axis" flexDirection="row">
      <Box width={label + 1} flexShrink={0} />
      {cellsLine(kit, 'axis', Array.from(axisLineOf(axis, timeline.startedAt)).map(ch => ({ ch, color: ch === '╱' ? TL_CELLS.fold : TL.axis })))}
    </Box>,
  ]
  layout.rows.forEach((row, i) => {
    const crossings = layout.crossings[i] ?? []
    if (row.kind === 'bg') {
      out.push(
        <Box key={`tl:bg:${row.bg.id}`} flexDirection="row">
          <Box width={label + 1} flexShrink={0}>
            <Text color={P.muted} wrap="truncate-end">
              {cutCells(`   └ ${row.bg.title}`, label, advance)}
            </Text>
          </Box>
          {cellsLine(kit, 'lane', backgroundCellsOf(row.bg, axis, crossings))}
        </Box>,
      )
      return
    }
    const lane = row.lane
    const { word, hue } = wordOf(lane)
    const indent = Math.min(3, Math.max(0, lane.depth - 1))
    // the name's room: the row's words less the indent, the face (and its mark), the two gaps and the word
    const name = cutCells(lane.title, Math.max(4, label + 1 - indent - avatarCells(kit, 18, true) - 2 - cellsOf(word, advance)), advance)
    const now = nowLineOf(rowOf.get(lane.id), lane, timeline)
    const open = () => actions.openAgent(lane.id)
    const cells = cellsLine(kit, 'lane', laneCellsOf(timeline, lane, axis, crossings))
    const nowText = cutCells(now, Math.max(4, kit.columns - indent - 2), advance)
    if (isRowButton(kit)) {
      // the terminal: its face, name and word one Button, its lane and its line under it each another, all opening its page
      out.push(
        <Box key={`tl:${lane.id}`} flexDirection="row">
          <Box width={label + 1} flexShrink={0} flexDirection="row" paddingLeft={indent}>
            <Box flexShrink={1} minWidth={0}>
              <Button key={agentKeyOf(lane.id)} label={name} plain onPress={open}>
                {avatar(kit, lane, 18, { dot: true })}
                {` ${name} `}
                <Text color={hue}>{word}</Text>
              </Button>
            </Box>
          </Box>
          <Button key={`tl:lane:${lane.id}`} label={`${lane.title}'s lane`} plain onPress={open}>
            {cells}
          </Button>
        </Box>,
      )
      if (now !== '') {
        out.push(
          <Box key={`tl:now:${lane.id}`} flexDirection="row" paddingLeft={indent + 2}>
            <Button key={`tl:said:${lane.id}`} label={nowText} plain onPress={open}>
              <Text color={P.muted2}>{nowText}</Text>
            </Button>
          </Box>,
        )
      }
      return
    }
    out.push(
      <Box key={`tl:${lane.id}`} flexDirection="row">
        <Box width={label + 1} flexShrink={0} flexDirection="row" columnGap={1} paddingLeft={indent}>
          <Box flexShrink={0}>{avatar(kit, lane, 18, { dot: true })}</Box>
          <Box flexShrink={1} minWidth={0}>
            <Button key={agentKeyOf(lane.id)} label={name} plain onPress={open} />
          </Box>
          <Box flexShrink={0}>
            <Text color={hue}>{word}</Text>
          </Box>
        </Box>
        {cells}
      </Box>,
    )
    if (now !== '') {
      out.push(
        <Box key={`tl:now:${lane.id}`} flexDirection="row" paddingLeft={indent + 2}>
          <Text color={P.muted2} wrap="truncate-end">
            {nowText}
          </Text>
        </Box>,
      )
    }
  })
  return out
}

/** The legend in cells: a sample of each mark the chart holds, and its words. */
function legendText(kit: Kit, keys: readonly LegendKey[]): RenderElement {
  const { Box, Text } = kit
  const SAMPLE: Readonly<Record<LegendKey, Cell>> = {
    call: { ch: 'Read', color: '#ffffff', bg: TL_CELLS.call },
    think: { ch: '─', color: TL_CELLS.think },
    fail: { ch: '✕', color: '#ffffff', bg: TL_CELLS.fail },
    wait: { ch: 'you', color: '#ffffff', bg: TL_CELLS.wait },
    done: { ch: '✓', color: TL.done },
    stopped: { ch: '■', color: TL.stopped },
    idle: { ch: '┄', color: TL_CELLS.idle },
    message: { ch: '↓', color: TL_CELLS.mark },
    you: { ch: '◆', color: TL.you },
    background: { ch: '━', color: TL.background },
    fold: { ch: '╱╱', color: TL_CELLS.fold },
  }
  const words: Readonly<Record<LegendKey, string>> = { ...LEGEND_WORDS, call: 'a tool call', fail: 'failed', fold: 'idle, folded' }
  return (
    <Box key="tl:legend" flexDirection="row">
      <Text wrap="wrap">
      {keys.map(key => {
        const sample = SAMPLE[key]
        return (
          <Text key={key}>
            {sample.bg ? (
              <Text color={sample.color} backgroundColor={sample.bg}>
                {sample.ch}
              </Text>
            ) : (
              <Text color={sample.color}>{sample.ch}</Text>
            )}
            <Text color={P.muted}>{` ${words[key]}  `}</Text>
          </Text>
        )
      })}
      </Text>
    </Box>
  )
}

/** The messages under the chart, the newest `MOST_MESSAGES`: each its number (its arrow's on the lanes), its time, who to whom, and its words. */
function messagesOf(kit: Kit, layout: TimelineLayout, state: Pick<WebStateV2, 'agents'>): RenderElement | null {
  const { Box, Text } = kit
  const { timeline } = layout
  if (layout.messages.length === 0) return null
  const shown = layout.messages.slice(-MOST_MESSAGES)
  const earlier = layout.messages.length - shown.length
  const lanes = new Map(timeline.lanes.map(lane => [lane.id, lane]))
  const rows = new Map(state.agents.flatMap(row => (row.row === 'agent' ? [[row.id, row] as const] : [])))
  const nameOf = (id: string) => lanes.get(id)?.title ?? rows.get(id)?.title ?? id
  const head = (
    <Box key="tl:messages:head" flexDirection="row" columnGap={2}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text bold color={P.muted}>
            MESSAGES
          </Text>
          <Text color={P.muted2}>{`  ${layout.messages.length}`}</Text>
        </Text>
      </Box>
      {svgOf(kit) ? (
        <Box flexShrink={0}>
          <Text color={P.muted2}>the numbers mark them on the lanes</Text>
        </Box>
      ) : null}
    </Box>
  )
  if (!svgOf(kit)) {
    const room = Math.max(8, Math.floor((kit.columns - 14) / 2))
    return (
      <Box key="tl:messages" flexDirection="column">
        {head}
        {shown.map(one => (
          <Box key={`tl:msg:${one.n}`} flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={P.muted2}>{`${Lanes.clockOf(timeline.startedAt + one.at)} `}</Text>
              <Text color={P.text}>{`${cutCells(nameOf(one.from), room)} → ${cutCells(nameOf(one.to), room)}`}</Text>
            </Text>
            <Box paddingLeft={6}>
              <Text color={P.fg2} wrap="wrap">{`“${one.title}”`}</Text>
            </Box>
          </Box>
        ))}
        {earlier > 0 ? quiet(kit, `and ${plural(earlier, 'earlier message')}: Chat holds them all.`) : null}
      </Box>
    )
  }
  const face = (id: string) => {
    const lane = lanes.get(id)
    return lane ? avatar(kit, lane, 14) : <Text color={P.muted3}>●</Text>
  }
  const room = Math.max(8, Math.floor((kit.columns - 20) / 2))
  const list = shown.flatMap((one, i) => [
    i > 0 ? rule(kit) : null,
    listRow(kit, `tl:msg:${one.n}`, [
      <Box key="n" flexShrink={0} width={2}>
        <Text bold color={P.fg2}>
          {String(one.n)}
        </Text>
      </Box>,
      <Box key="body" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Box flexShrink={0}>
            <Text color={P.muted2}>{Lanes.clockOf(timeline.startedAt + one.at)}</Text>
          </Box>
          <Box flexShrink={0}>{face(one.from)}</Box>
          <Box flexShrink={0}>
            <Text color={P.text}>{cutCells(nameOf(one.from), room, uiAdvance)}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={P.muted2}>→</Text>
          </Box>
          <Box flexShrink={0}>{face(one.to)}</Box>
          <Box flexShrink={1} minWidth={0}>
            <Text color={P.text} wrap="truncate-end">
              {nameOf(one.to)}
            </Text>
          </Box>
        </Box>
        <Text color={P.fg2} wrap="wrap">{`“${one.title}”`}</Text>
      </Box>,
    ]),
  ])
  return (
    <Box key="tl:messages" flexDirection="column" rowGap={1}>
      {head}
      {listBox(kit, 'tl:messages:list', list)}
      {earlier > 0 ? quiet(kit, `and ${plural(earlier, 'earlier message')}: Chat holds them all.`) : null}
    </Box>
  )
}

/**
 * Org's Timeline: its summary ("3h 51m · 4 agents · …", and what folded),
 * the chart (a row an agent beside its lane, images on the desktop, cells
 * on the terminal), "and n more" past the newest 20, the legend, then the
 * messages; a quiet line while there is no timeline.
 */
export function timelineView(kit: Kit, timeline: V2Timeline | null, state: Pick<WebStateV2, 'agents'>, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  if (!timeline || timeline.lanes.length === 0) return quiet(kit, 'No timeline yet: each agent shows here as a lane once Claude Code reports its work.')
  const layout = layoutOf(timeline)
  const Svg = svgOf(kit)
  const folded = foldSummaryOf(layout.folds)
  const keys = legendOf(layout)
  const summary = (
    <Box key="org:timeline:summary" flexDirection="row" columnGap={2}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={P.muted2} wrap="truncate-end">
          {timelineSummaryOf(timeline, layout.messages.length)}
        </Text>
      </Box>
      {folded ? (
        <Box flexShrink={0}>
          <Text color={P.muted2}>{Svg ? `⋯ ${folded}` : `╱╱╱ ${folded}`}</Text>
        </Box>
      ) : null}
    </Box>
  )
  const more = layout.more > 0 ? quiet(kit, `and ${plural(layout.more, 'more agent')}, started earlier: /apiarius web shows them all.`) : null
  const width = Math.floor(kit.columns * CELL_PX) - 4
  const legend = Svg ? legendSvg(keys, width) : null
  return (
    <Box key="org:timeline" flexDirection="column" gap={1}>
      {summary}
      <Box key="org:timeline:lanes" flexDirection="column">
        {Svg ? svgRows(kit, layout, state, actions) : cellRows(kit, layout, state, actions)}
      </Box>
      {more}
      {Svg && legend ? (
        <Box key="org:timeline:legend" flexShrink={0}>
          <Svg source={memo(`legend|${keys.join(',')}|${width}`, () => legend.svg)} alt={`Legend: ${keys.map(key => LEGEND_WORDS[key]).join(', ')}`} width={width} height={legend.height} />
        </Box>
      ) : (
        legendText(kit, keys)
      )}
      {messagesOf(kit, layout, state)}
    </Box>
  )
}

/** The timeline as Org draws it over `state`: the lanes of the agents "Clear finished" hid since it was made left out, and the background tasks of theirs that ended (the sample's is made once). */
export function shownTimelineOf(timeline: V2Timeline | null, state: Pick<WebStateV2, 'agents'>): V2Timeline | null {
  if (!timeline) return null
  const hidden = new Set(state.agents.flatMap(row => (row.row === 'agent' && row.isCleared ? [row.id] : [])))
  if (hidden.size === 0) return timeline
  return { ...timeline, lanes: timeline.lanes.filter(lane => !hidden.has(lane.id)), background: timeline.background.filter(one => one.end === null || !hidden.has(one.by)) }
}

/** The keys of the Buttons the Timeline draws, in order: each lane's name. */
export function timelineKeysOf(timeline: V2Timeline | null): string[] {
  return timeline ? Lanes.newestOf(timeline.lanes, MOST_LANES).lanes.map(lane => agentKeyOf(lane.id)) : []
}
