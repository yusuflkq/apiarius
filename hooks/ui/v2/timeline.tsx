/**
 * Org's Timeline in the pane (web/CONTRACT.md, "The timeline"): one lane an
 * agent from its start to its end (or to now), the Orchestrator first, from
 * ../../timeline's `V2Timeline` (the live deck's, or the sample's
 * timeline.json).
 *
 * - On the desktop, one plain Svg image (not interactive) as wide as the
 *   pane: a time axis with its "now" line, each lane's label, its work
 *   (blue) and waits on you (amber) as bars, idle as a dotted line, its
 *   tool calls as ticks thinned to the pixels there are, your prompts as a
 *   white diamond on the Orchestrator's lane, spawns as dotted lines from
 *   the parent's lane, messages between agents as arrows, each outcome at
 *   its lane's end (● done, ✕ failed, ■ stopped), and a legend of what it
 *   drew. Under it each agent's name, a plain Button that opens its page.
 * - On the terminal (and wherever no Svg draws), text lanes fitted to the
 *   columns: `━` working in blue, `━` waiting on you in amber, `┄` idle,
 *   `●` done, `✕` failed, `■` stopped, `◆` your prompt, under a time axis;
 *   each lane's name a plain Button. A box-drawing glyph takes a cell on the
 *   terminal and about 1.17 in a desktop's face, so off the terminal each
 *   stretch is a Box as wide as its time, filled with as many glyphs as fit.
 *
 * Pure: Kit, the state, the timeline and DashActions come from the hooks
 * module.
 */
import type { RenderElement } from 'claude-code'

import type { V2Lane, V2Timeline } from '../../timeline'
import { agentKeyOf, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { quiet, svgOf } from './look'
import { P } from './palette'
import { CELL_PX } from './parts'
import { cutCells, monoAdvance, plural, uiAdvance } from './text'

/** The lanes the pane draws at most: past them, "N more" (the web page draws them all). */
export const MOST_LANES = 40

/** The colours the timeline draws in, the web page's (web/app.css `.tl-*`). */
export const TL = {
  run: P.run,
  wait: P.wait,
  idle: P.muted3,
  done: P.done,
  fail: P.fail,
  stopped: P.idle,
  tick: '#bfdbfe',
  failTick: P.failText,
  grid: P.chip,
  axis: P.muted2,
  label: P.fg2,
  now: P.runText,
  you: P.text,
  spawn: P.muted2,
  message: P.fg2,
  background: '#64748b',
} as const

/** The gridline steps the axis picks from, ms: the first that leaves room between labels. */
const STEPS = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400].map(s => s * 1000)

/** How long the axis runs, ms: from its start to now (a minute at least). */
export function axisSpanOf(timeline: Pick<V2Timeline, 'now' | 'startedAt'>): number {
  return Math.max(60_000, timeline.now - timeline.startedAt)
}

/** The gridlines' step for `span` ms over `room` (px or cells): the first whose labels stand `gap` apart. */
export function axisStepOf(span: number, room: number, gap: number): number {
  for (const step of STEPS) if ((step / span) * room >= gap) return step
  return STEPS[STEPS.length - 1] ?? 86_400_000
}

/** A gridline's words, its time after the axis's start: "0m", "10m", "1h", "1h 30m"; "30s" under a minute. */
export function axisLabelOf(ms: number): string {
  if (ms < 60_000 && ms > 0) return `${Math.round(ms / 1000)}s`
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`
}

/** "42m · 8 agents · 2 in the background": how long the timeline runs, its lanes and its background shells. */
export function timelineSummaryOf(timeline: V2Timeline): string {
  const span = axisSpanOf(timeline)
  const parts = [axisLabelOf(span).replace(/^0m$/, '<1m'), plural(timeline.lanes.length, 'agent')]
  if (timeline.background.length > 0) parts.push(`${timeline.background.length} in the background`)
  return parts.join(' · ')
}

/** Words for an SVG document, its markup characters escaped. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)
}

/** A number for an SVG attribute: a tenth of a px at most. */
function n1(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/** The px a word takes at `size` px in the desktop's face (its cell is 7.85 px at 13 px). */
function textPx(text: string, size: number): number {
  let cells = 0
  for (const ch of Array.from(text)) cells += uiAdvance(ch)
  return (cells * CELL_PX * size) / 13
}

/** `text` cut with "…" to `px` at `size` px. */
function cutPx(text: string, px: number, size: number): string {
  return cutCells(text, (px * 13) / (CELL_PX * size), uiAdvance)
}

/** A lane's ticks kept for `room` px: none closer than `gap` px to the one kept before (a failed one always kept). */
export function thinTicks(lane: Pick<V2Lane, 'ticks'>, x: (ms: number) => number, gap: number): { x: number; failed: boolean }[] {
  const out: { x: number; failed: boolean }[] = []
  let last = -Infinity
  for (const tick of lane.ticks) {
    const at = x(tick[0])
    const failed = tick[3] === 0
    if (at - last < gap && !failed) continue
    out.push({ x: at, failed })
    last = at
  }
  return out
}

/** What a legend shows: only what the drawing holds. */
function legendOf(timeline: V2Timeline, lanes: readonly V2Lane[]): { kind: string; label: string }[] {
  const has = (kind: string) => lanes.some(lane => lane.spans.some(span => span.kind === kind))
  const out: { kind: string; label: string }[] = []
  if (has('work')) out.push({ kind: 'work', label: 'working' })
  if (has('wait')) out.push({ kind: 'wait', label: 'waiting on you' })
  if (has('idle')) out.push({ kind: 'idle', label: 'idle' })
  if (lanes.some(lane => lane.outcome === 'done')) out.push({ kind: 'done', label: 'done' })
  if (lanes.some(lane => lane.outcome === 'failed')) out.push({ kind: 'failed', label: 'failed' })
  if (lanes.some(lane => lane.outcome === 'stopped')) out.push({ kind: 'stopped', label: 'stopped' })
  if (timeline.marks.length > 0) out.push({ kind: 'you', label: 'you wrote' })
  if (lanes.some(lane => lane.ticks.length > 0)) out.push({ kind: 'tick', label: 'a tool call' })
  if (lanes.some(lane => lane.parent !== null)) out.push({ kind: 'spawn', label: 'started by' })
  if (timeline.messages.length > 0) out.push({ kind: 'message', label: 'a message' })
  return out
}

/** The most characters the ticks of one image take, so the pane's drawing keeps under its bound. */
const TICK_CHARS = 60_000

/**
 * The timeline as one SVG document `width` px across (the pane's): its
 * axis, lanes, ticks, marks, spawns, messages, background lanes and legend.
 * Its lanes are `lanes` (the pane's first 40).
 */
export function timelineSvgOf(timeline: V2Timeline, lanes: readonly V2Lane[], width: number): { svg: string; width: number; height: number } {
  const W = Math.max(320, Math.round(width))
  const L = Math.round(Math.min(160, Math.max(92, W * 0.18)))
  const LANE = 26
  const TOP = 24
  const right = W - 16
  const span = axisSpanOf(timeline)
  const X = (ms: number) => L + ((right - L) * Math.min(span, Math.max(0, ms))) / span
  const yOf = (i: number) => TOP + i * LANE + LANE / 2
  const bg = timeline.background
  const bgTop = TOP + lanes.length * LANE + 8
  const lanesBottom = bg.length > 0 ? bgTop + 14 + bg.length * LANE : TOP + lanes.length * LANE
  // the legend, wrapped to the width
  const legend = legendOf(timeline, lanes)
  const rows: { kind: string; label: string; x: number }[][] = [[]]
  let lx = 0
  for (const item of legend) {
    const w = 19 + textPx(item.label, 11) + 16
    if (lx + w > W && lx > 0) {
      rows.push([])
      lx = 0
    }
    rows[rows.length - 1]?.push({ ...item, x: lx })
    lx += w
  }
  const legendTop = lanesBottom + 22
  const H = legendTop + rows.length * 18
  const out: string[] = []
  // the axis: gridlines and their words, then now
  const step = axisStepOf(span, right - L, 48)
  const nowX = X(span)
  for (let ms = 0; ms <= span; ms += step) {
    const x = X(ms)
    out.push(`<line x1="${n1(x)}" x2="${n1(x)}" y1="16" y2="${lanesBottom}" stroke="${TL.grid}"/>`)
    if (nowX - x > 26) out.push(`<text x="${n1(x)}" y="11" fill="${TL.axis}" font-size="11" text-anchor="middle">${axisLabelOf(ms)}</text>`)
  }
  out.push(`<line x1="${n1(nowX)}" x2="${n1(nowX)}" y1="16" y2="${lanesBottom}" stroke="${TL.now}" stroke-dasharray="3 3"/><text x="${n1(nowX)}" y="11" fill="${TL.now}" font-size="11" text-anchor="end">now</text>`)
  const index = new Map(lanes.map((lane, i) => [lane.id, i]))
  // spawns: from the parent's lane at the child's start
  lanes.forEach((lane, i) => {
    const at = lane.parent !== null ? index.get(lane.parent) : undefined
    if (at === undefined) return
    const x = n1(X(lane.start))
    const [a, b] = at < i ? [yOf(at) + 5, yOf(i) - 6] : [yOf(at) - 5, yOf(i) + 6]
    out.push(`<path d="M${x} ${a}V${b}" stroke="${TL.spawn}" stroke-width="1" fill="none" stroke-dasharray="1 2"/>`)
  })
  // the lanes
  let tickBudget = TICK_CHARS
  const gapFor = (count: number) => (count * 14 > tickBudget ? Math.max(3, (count * 14 * 3) / Math.max(1, tickBudget)) : 3)
  lanes.forEach((lane, i) => {
    const y = yOf(i)
    const indent = Math.min(lane.depth, 4) * 8
    const name = cutPx(lane.title, L - indent - 10, 12)
    out.push(`<text x="${indent}" y="${y + 4}" fill="${TL.label}" font-size="12">${esc(name)}</text>`)
    for (const one of lane.spans) {
      const a = X(one.from)
      const b = X(one.to ?? span)
      if (one.kind === 'idle') out.push(`<line x1="${n1(a)}" x2="${n1(b)}" y1="${y}" y2="${y}" stroke="${TL.idle}" stroke-width="2" stroke-dasharray="2 3"/>`)
      else out.push(`<rect x="${n1(a)}" y="${y - 5}" width="${n1(Math.max(3, b - a))}" height="10" rx="5" fill="${one.kind === 'wait' ? TL.wait : TL.run}"/>`)
    }
    const kept = thinTicks(lane, X, gapFor(lane.ticks.length))
    tickBudget = Math.max(2000, tickBudget - kept.length * 14)
    const ok = kept.filter(one => !one.failed).map(one => `M${n1(one.x)} ${y - 3}v6`)
    const bad = kept.filter(one => one.failed).map(one => `M${n1(one.x)} ${y - 4}v8`)
    if (ok.length > 0) out.push(`<path d="${ok.join('')}" stroke="${TL.tick}" stroke-opacity=".55"/>`)
    if (bad.length > 0) out.push(`<path d="${bad.join('')}" stroke="${TL.failTick}" stroke-width="1.5"/>`)
    if (lane.end !== null && lane.outcome !== null) {
      const x = X(lane.end)
      if (lane.outcome === 'done') out.push(`<circle cx="${n1(x)}" cy="${y}" r="4.5" fill="${TL.done}"/>`)
      else if (lane.outcome === 'failed') out.push(`<g stroke="${TL.fail}" stroke-width="2.2" stroke-linecap="round"><line x1="${n1(x - 4)}" y1="${y - 4}" x2="${n1(x + 4)}" y2="${y + 4}"/><line x1="${n1(x + 4)}" y1="${y - 4}" x2="${n1(x - 4)}" y2="${y + 4}"/></g>`)
      else out.push(`<rect x="${n1(x - 4)}" y="${y - 4}" width="8" height="8" rx="1.5" fill="${TL.stopped}"/>`)
    }
  })
  // your prompts, on the Orchestrator's lane
  const main = index.get('main')
  if (main !== undefined) for (const mark of timeline.marks) out.push(`<path d="M${n1(X(mark.at))} ${yOf(main) - 9}l5 5-5 5-5-5z" fill="${TL.you}"/>`)
  // messages between agents: an arrow from the sender's lane to the receiver's, the newest few named where they fit
  const taken: { x0: number; x1: number; y: number }[] = []
  const messages = timeline.messages.filter(one => index.has(one.from) && index.has(one.to))
  messages.forEach((one, k) => {
    const from = index.get(one.from) as number
    const to = index.get(one.to) as number
    const x = X(one.at)
    const down = to > from
    const a = yOf(from) + (down ? 6 : -6)
    const b = yOf(to) + (down ? -8 : 8)
    out.push(`<path d="M${n1(x)} ${a}V${b}" stroke="${TL.message}" stroke-width="1.4" fill="none" marker-end="url(#tl-arrow)"/>`)
    if (messages.length - k > 3) return
    const words = cutPx(`${lanes[from]?.title ?? ''} → ${lanes[to]?.title ?? ''}: “${one.title}”`, Math.max(80, x - L - 4), 10)
    const w = textPx(words, 10)
    const ly = yOf(from) + (down ? 16 : -10)
    if (taken.some(box => Math.abs(box.y - ly) < 12 && box.x0 < x && x - w - 4 < box.x1)) return
    taken.push({ x0: x - w - 4, x1: x, y: ly })
    out.push(`<text x="${n1(x - 4)}" y="${ly}" fill="${TL.message}" font-size="10" text-anchor="end">${esc(words)}</text>`)
  })
  // the background shells, under the agents
  if (bg.length > 0) {
    out.push(`<text x="0" y="${bgTop + 4}" fill="${TL.axis}" font-size="10" letter-spacing="0.6">BACKGROUND</text>`)
    bg.forEach((one, i) => {
      const y = bgTop + 14 + i * LANE + LANE / 2 - 4
      out.push(`<text x="0" y="${y + 4}" fill="${P.muted}" font-size="12">${esc(cutPx(one.title, L - 10, 12))}</text>`)
      const a = X(one.start)
      out.push(`<rect x="${n1(a)}" y="${y - 4}" width="${n1(Math.max(3, X(one.end ?? span) - a))}" height="8" rx="4" fill="${TL.background}"/>`)
    })
  }
  // the legend: what the drawing holds
  rows.forEach((row, r) => {
    const ly = legendTop + r * 18
    for (const item of row) {
      const x = item.x
      if (item.kind === 'work' || item.kind === 'wait') out.push(`<rect x="${n1(x)}" y="${ly - 8}" width="14" height="8" rx="4" fill="${item.kind === 'wait' ? TL.wait : TL.run}"/>`)
      if (item.kind === 'idle') out.push(`<line x1="${n1(x)}" x2="${n1(x + 14)}" y1="${ly - 4}" y2="${ly - 4}" stroke="${TL.idle}" stroke-width="2" stroke-dasharray="2 3"/>`)
      if (item.kind === 'done') out.push(`<circle cx="${n1(x + 7)}" cy="${ly - 4}" r="4" fill="${TL.done}"/>`)
      if (item.kind === 'failed') out.push(`<g stroke="${TL.fail}" stroke-width="2" stroke-linecap="round"><line x1="${n1(x + 3)}" y1="${ly - 8}" x2="${n1(x + 11)}" y2="${ly}"/><line x1="${n1(x + 11)}" y1="${ly - 8}" x2="${n1(x + 3)}" y2="${ly}"/></g>`)
      if (item.kind === 'stopped') out.push(`<rect x="${n1(x + 3)}" y="${ly - 8}" width="8" height="8" rx="1.5" fill="${TL.stopped}"/>`)
      if (item.kind === 'you') out.push(`<path d="M${n1(x + 7)} ${ly - 9}l5 5-5 5-5-5z" fill="${TL.you}"/>`)
      if (item.kind === 'tick') out.push(`<rect x="${n1(x)}" y="${ly - 8}" width="14" height="8" rx="4" fill="${TL.run}"/><line x1="${n1(x + 7)}" x2="${n1(x + 7)}" y1="${ly - 7}" y2="${ly - 1}" stroke="${TL.tick}"/>`)
      if (item.kind === 'spawn') out.push(`<path d="M${n1(x + 7)} ${ly - 10}V${ly + 2}" stroke="${TL.spawn}" fill="none" stroke-dasharray="1 2"/>`)
      if (item.kind === 'message') out.push(`<path d="M${n1(x + 7)} ${ly - 10}V${ly - 1}" stroke="${TL.message}" stroke-width="1.4" fill="none" marker-end="url(#tl-arrow)"/>`)
      out.push(`<text x="${n1(x + 19)}" y="${ly}" fill="${P.muted}" font-size="11">${item.label}</text>`)
    }
  })
  const defs = `<defs><marker id="tl-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${P.muted}"/></marker></defs>`
  const font = 'Anthropic Sans, anthropic-sans, system-ui, -apple-system, Segoe UI, sans-serif'
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">${defs}${out.join('')}</svg>`, width: W, height: H }
}

/** One cell of a text lane: its glyph and colour. */
type Cell = { ch: string; color: string }

const BLANK: Cell = { ch: ' ', color: P.muted3 }

/**
 * A lane as `cells` text cells over `span` ms: in each, the most telling
 * stretch that touches it (waiting on you over working over idle), its
 * outcome in the cell its run ended in, and on the Orchestrator's lane a
 * prompt of yours as `◆`.
 */
export function laneCellsOf(lane: V2Lane, cells: number, span: number, marks: readonly { at: number }[] = []): Cell[] {
  const out: Cell[] = Array.from({ length: cells }, () => BLANK)
  const cellOf = (ms: number) => Math.min(cells - 1, Math.max(0, Math.floor((Math.min(span, Math.max(0, ms)) / span) * cells)))
  const rank = { idle: 1, work: 2, wait: 3 }
  const seen = new Array<number>(cells).fill(0)
  for (const one of lane.spans) {
    const a = cellOf(one.from)
    const b = one.to === null ? cells - 1 : cellOf(Math.max(one.from, one.to - 1))
    const cell: Cell = one.kind === 'idle' ? { ch: '┄', color: TL.idle } : { ch: '━', color: one.kind === 'wait' ? TL.wait : TL.run }
    for (let i = a; i <= b; i++) {
      if ((seen[i] ?? 0) >= rank[one.kind]) continue
      seen[i] = rank[one.kind]
      out[i] = cell
    }
  }
  for (const mark of marks) out[cellOf(mark.at)] = { ch: '◆', color: TL.you }
  if (lane.end !== null && lane.outcome !== null) {
    const at = cellOf(Math.max(0, lane.end - 1))
    out[at] = lane.outcome === 'done' ? { ch: '●', color: TL.done } : lane.outcome === 'failed' ? { ch: '✕', color: TL.fail } : { ch: '■', color: TL.stopped }
  }
  return out
}

/** Cells as runs of one glyph in one colour. */
function runsOf(cells: readonly Cell[]): { ch: string; color: string; count: number }[] {
  const out: { ch: string; color: string; count: number }[] = []
  for (const cell of cells) {
    const last = out[out.length - 1]
    if (last && last.ch === cell.ch && last.color === cell.color) last.count += 1
    else out.push({ ...cell, count: 1 })
  }
  return out
}

/** The axis as one line of `cells` cells: each gridline's words where they fit, "now" at its end. */
export function axisLineOf(span: number, cells: number): string {
  const line = new Array<string>(cells).fill(' ')
  const nowAt = cells - 3
  const step = axisStepOf(span, cells, 8)
  let free = 0
  for (let ms = 0; ms <= span; ms += step) {
    const words = axisLabelOf(ms)
    const at = Math.floor((ms / span) * cells)
    if (at < free || at + words.length >= nowAt - 1) continue
    for (let i = 0; i < words.length; i++) line[at + i] = words[i] ?? ' '
    free = at + words.length + 1
  }
  if (cells >= 3) for (let i = 0; i < 3; i++) line[nowAt + i] = 'now'[i] ?? ' '
  return line.join('')
}

/** The cells of a text lane's glyphs where `kit` draws: the terminal's one a glyph; a desktop's face about 1.17 a box-drawing glyph. */
const BOX_CELLS = 1.17

/** Text lanes: the axis, a row a lane (its name a Button that opens its page), the background shells, the legend. */
function textLanes(kit: Kit, timeline: V2Timeline, lanes: readonly V2Lane[], actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const isMono = kit.surface === 'terminal'
  const advance = isMono ? monoAdvance : uiAdvance
  const label = Math.min(18, Math.max(8, Math.floor(kit.columns * 0.24)))
  const room = Math.max(10, kit.columns - label - 1)
  const cells = isMono ? room : Math.floor(room / BOX_CELLS)
  const span = axisSpanOf(timeline)
  /** A row of runs: on the terminal one Text of coloured runs; elsewhere a Box a run, as wide as its cells' time. */
  const lineOf = (key: string, runs: { ch: string; color: string; count: number }[]) =>
    isMono ? (
      <Text key={key} wrap="truncate-end">
        {runs.map((run, i) => (
          <Text key={`r${i}`} color={run.color}>
            {run.ch.repeat(run.count)}
          </Text>
        ))}
      </Text>
    ) : (
      <Box key={key} flexDirection="row">
        {runs.map((run, i) => (
          <Box key={`r${i}`} width={Math.max(1, Math.round(run.count * BOX_CELLS * 100) / 100)} flexShrink={0}>
            {run.ch === ' ' ? null : <Text color={run.color}>{run.ch.repeat(Math.max(1, Math.floor((run.count * BOX_CELLS) / Math.max(0.4, advance(run.ch)))))}</Text>}
          </Box>
        ))}
      </Box>
    )
  const legend = legendOf(timeline, lanes)
  const LEGEND: Readonly<Record<string, Cell>> = {
    work: { ch: '━', color: TL.run },
    wait: { ch: '━', color: TL.wait },
    idle: { ch: '┄', color: TL.idle },
    done: { ch: '●', color: TL.done },
    failed: { ch: '✕', color: TL.fail },
    stopped: { ch: '■', color: TL.stopped },
    you: { ch: '◆', color: TL.you },
  }
  return (
    <Box key="org:timeline:lanes" flexDirection="column">
      <Box flexDirection="row">
        <Box width={label + 1} flexShrink={0} />
        <Text color={TL.axis} wrap="truncate-end">
          {axisLineOf(span, cells)}
        </Text>
      </Box>
      {lanes.map(lane => {
        const indent = Math.min(lane.depth, 3)
        const name = cutCells(`${' '.repeat(indent)}${lane.title}`, label, advance)
        return (
          <Box key={`tl:${lane.id}`} flexDirection="row">
            <Box width={label + 1} flexShrink={0}>
              <Button key={agentKeyOf(lane.id)} label={name} plain onPress={() => actions.openAgent(lane.id)} />
            </Box>
            {lineOf('lane', runsOf(laneCellsOf(lane, cells, span, lane.id === 'main' ? timeline.marks : [])))}
          </Box>
        )
      })}
      {timeline.background.length > 0 ? (
        <Box flexDirection="column">
          <Text color={TL.axis}>BACKGROUND</Text>
          {timeline.background.map(one => {
            const a = Math.floor((Math.max(0, one.start) / span) * cells)
            const b = one.end === null ? cells : Math.max(a + 1, Math.ceil((Math.min(span, one.end) / span) * cells))
            return (
              <Box key={`tl:bg:${one.id}`} flexDirection="row">
                <Box width={label + 1} flexShrink={0}>
                  <Text color={P.muted} wrap="truncate-end">
                    {cutCells(one.title, label, advance)}
                  </Text>
                </Box>
                {lineOf('lane', runsOf([...new Array<Cell>(a).fill(BLANK), ...new Array<Cell>(Math.max(0, b - a)).fill({ ch: '━', color: TL.background })]))}
              </Box>
            )
          })}
        </Box>
      ) : null}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {legend
          .filter(item => LEGEND[item.kind])
          .map(item => (
            <Text key={item.kind}>
              <Text color={LEGEND[item.kind]?.color}>{LEGEND[item.kind]?.ch}</Text>
              <Text color={P.muted}>{` ${item.label}`}</Text>
            </Text>
          ))}
      </Box>
    </Box>
  )
}

/**
 * Org's Timeline: its summary ("42m · 8 agents"), then the image where Svg
 * draws (each agent's name under it a Button to its page), else the text
 * lanes; a quiet line while there is no timeline.
 */
export function timelineView(kit: Kit, timeline: V2Timeline | null, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  if (!timeline || timeline.lanes.length === 0) return quiet(kit, 'No timeline yet: each agent shows here as a lane once Claude Code reports its work.')
  const lanes = timeline.lanes.slice(0, MOST_LANES)
  const more = timeline.lanes.length - lanes.length
  const Svg = svgOf(kit)
  const summary = (
    <Text key="org:timeline:summary" color={P.muted2} wrap="truncate-end">
      {timelineSummaryOf(timeline)}
    </Text>
  )
  const moreLine = more > 0 ? quiet(kit, `${plural(more, 'more agent')}: more than the pane holds. /deck web shows them all.`) : null
  if (!Svg) {
    return (
      <Box key="org:timeline" flexDirection="column" gap={1}>
        {summary}
        {textLanes(kit, timeline, lanes, actions)}
        {moreLine}
      </Box>
    )
  }
  const image = timelineSvgOf(timeline, lanes, Math.floor(kit.columns * CELL_PX) - 4)
  return (
    <Box key="org:timeline" flexDirection="column" gap={1}>
      {summary}
      <Box key="org:timeline:image" flexShrink={0}>
        <Svg source={image.svg} alt="The timeline: each agent's work, waits on you and idle time" width={image.width} height={image.height} />
      </Box>
      <Box key="org:timeline:open" flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text color={P.muted2}>Open</Text>
        {lanes.map(lane => (
          <Button key={agentKeyOf(lane.id)} label={lane.title} plain dimColor onPress={() => actions.openAgent(lane.id)} />
        ))}
      </Box>
      {moreLine}
    </Box>
  )
}

/** The timeline as Org draws it over `state`: the lanes of the agents "Clear finished" hid since it was made left out (the sample's is made once). */
export function shownTimelineOf(timeline: V2Timeline | null, state: Pick<WebStateV2, 'agents'>): V2Timeline | null {
  if (!timeline) return null
  const hidden = new Set(state.agents.flatMap(row => (row.row === 'agent' && row.isCleared ? [row.id] : [])))
  return hidden.size === 0 ? timeline : { ...timeline, lanes: timeline.lanes.filter(lane => !hidden.has(lane.id)) }
}

/** The keys of the Buttons the Timeline draws, in order: each lane's name. */
export function timelineKeysOf(timeline: V2Timeline | null): string[] {
  return (timeline?.lanes ?? []).slice(0, MOST_LANES).map(lane => agentKeyOf(lane.id))
}
