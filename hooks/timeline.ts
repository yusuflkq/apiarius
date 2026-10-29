/**
 * Org's Timeline (web/CONTRACT.md, "The timeline"): the whole run at a
 * glance, one lane an agent from its start to its end (or to now), in the
 * tree's order with the Orchestrator first. Built once here from the deck's
 * model and the v2 state, and drawn three ways: the web page's SVG
 * (timeline.json, GET /timeline), the Desktop pane's image and the
 * terminal's text lanes (./ui/v2/timeline).
 *
 * Every span, tick and mark is a time Claude Code reported, as the deck
 * kept it (./lane, ./model):
 * - work: an agent's runs (from its spawn, or the moment it ran again, to
 *   its end); the Orchestrator's turns (`turn.start` to its end);
 * - waiting on you: a need raised to its answer (a call held on you until
 *   it ended; Claude Code's notification until its loop moved on);
 * - idle: between two runs or turns the deck saw both of, and after an
 *   idle teammate's or the Orchestrator's last;
 * - ticks: tool calls' starts, lengths and outcomes;
 * - marks: your prompts to the Orchestrator; messages between agents (the
 *   chat's SendMessage rows); each lane's outcome (done, failed, stopped);
 * - background tasks: each from the call that started it, under the loop
 *   that made that call, to now while its row is on the Dashboard's
 *   Background, else to the moment Claude Code said it ended.
 * Where the deck does not know when something happened, nothing is drawn.
 *
 * Pure: the same model, state and time build the same timeline.
 */
import type { DeckActivity, DeckAgent, DeckData } from '../types'
import * as F from './format'
import * as M from './model'
import type { V2AgentRow, V2Status, WebStateV2 } from './web'

/** One stretch of a lane: at work, waiting on you, or idle; `to` null while it lasts (to now). */
export type V2Span = { kind: 'work' | 'wait' | 'idle'; from: number; to: number | null }

/**
 * One tool call: `[start, length, tool, how, text?]`, its start in ms after
 * the timeline's `startedAt`, its length in ms (-1: its end not seen), its
 * tool's place in the timeline's `tools`, how it went (1 ok, 0 failed, -1
 * not known: running, or its end not seen), and what it was given (a
 * shell's command, else its target) while the deck keeps it whole (the
 * newest 14 of its agent's).
 */
export type V2Tick = [number, number, number, number, string?]

/** One agent's lane. */
export type V2Lane = {
  /** Its row's id in the state's `agents` (`main` the Orchestrator). */
  id: string
  /** Its row's title. */
  title: string
  /** The lane its spawn came from (its row's parent, when that lane is drawn); null for the Orchestrator and a lane whose parent is not drawn. */
  parent: string | null
  /** 0 for the Orchestrator, one more per spawn under it. */
  depth: number
  kind: V2AgentRow['kind']
  /** Its row's status, and whether it was stopped. */
  status: V2Status
  isStopped: boolean
  /** Where its lane begins, ms after the timeline's `startedAt`: its spawn (its Agent call); the Orchestrator's first turn the deck saw. */
  start: number
  /** Where it ends: its run's end; null while it is at work, waits on you, or idles to now (an idle teammate, the Orchestrator). */
  end: number | null
  /** How its run ended: done, failed or stopped; null while it is at work or idle, and for the Orchestrator. */
  outcome: 'done' | 'failed' | 'stopped' | null
  /** Its stretches, oldest first: work, then idle between, then the waits on you over them (each wait within the lane). */
  spans: V2Span[]
  /** Its tool calls, oldest first (the newest 400 the deck keeps, and its newest 14 whole). */
  ticks: V2Tick[]
}

/**
 * A background task's lane (`backgroundLanesOf`): its row's id, title and
 * kind with what Claude Code said of it ("Shell · Start the dev server"),
 * the loop whose call started it (`main` or an agent's id: drawn under that
 * lane), from that call to its end; null while it runs.
 */
export type V2BackgroundLane = { id: string; title: string; what: string; by: string; start: number; end: number | null }

/** Org's Timeline, every time in ms after `startedAt` (so moving `startedAt` and `now` moves it all). */
export type V2Timeline = {
  v: 2
  /** When it was built: the state's `now`, ms since the epoch. */
  now: number
  /** Where its axis begins, ms since the epoch: the earliest lane's start. */
  startedAt: number
  /** The tools the ticks name, each once. */
  tools: string[]
  /** One lane an agent drawn, in the tree's order (each under the one that started it, as they started), the Orchestrator first; the agents "Clear finished" hid left out. */
  lanes: V2Lane[]
  /** Your prompts and words to the Orchestrator (the chat's rows from you to it): when, the row's id, its first line. */
  marks: { at: number; id: string; text: string }[]
  /** Messages between two agents drawn (the chat's SendMessage rows): when, who to whom, the row's id, its summary (else its first line). */
  messages: { at: number; from: string; to: string; id: string; title: string }[]
  /** The background tasks' lanes (`backgroundLanesOf`), as they started: those the deck saw start, each under the lane that started it; none with nothing in the background. */
  background: V2BackgroundLane[]
}

/** The most characters a tick's text, a mark's or a message's title keeps. */
export const TIMELINE_TEXT = 120

/** The agents as the timeline lays them: the rows shown (none "Clear finished" hid), each under the one that started it, siblings as they started, the Orchestrator first. */
function laneRowsOf(state: Pick<WebStateV2, 'agents'>): { row: V2AgentRow; depth: number; parent: string | null }[] {
  const rows = state.agents.filter((row): row is V2AgentRow => row.row === 'agent' && !row.isCleared)
  const ids = new Set(rows.map(row => row.id))
  const parentOf = (row: V2AgentRow) => (row.parent !== null && row.parent !== row.id && ids.has(row.parent) ? row.parent : null)
  const order = (a: V2AgentRow, b: V2AgentRow) => Number(b.id === M.MAIN) - Number(a.id === M.MAIN) || a.startedAt - b.startedAt
  const kids = new Map<string, V2AgentRow[]>()
  const roots: V2AgentRow[] = []
  for (const row of rows) {
    const parent = parentOf(row)
    if (parent === null) roots.push(row)
    else kids.set(parent, [...(kids.get(parent) ?? []), row])
  }
  roots.sort(order)
  for (const list of kids.values()) list.sort(order)
  const out: { row: V2AgentRow; depth: number; parent: string | null }[] = []
  const seen = new Set<string>()
  const walk = (row: V2AgentRow, depth: number) => {
    if (seen.has(row.id)) return
    seen.add(row.id)
    out.push({ row, depth, parent: parentOf(row) })
    for (const kid of kids.get(row.id) ?? []) walk(kid, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  for (const row of rows) walk(row, 0)
  return out
}

/** Runs, `[from, to]` (to null: to now), sorted and joined where they touch or overlap. */
function joined(runs: readonly (readonly [number, number | null])[]): [number, number | null][] {
  const sorted = [...runs].filter(([from, to]) => to === null || to >= from).sort((a, b) => a[0] - b[0])
  const out: [number, number | null][] = []
  for (const [from, to] of sorted) {
    const last = out[out.length - 1]
    if (last && (last[1] === null || from <= last[1])) {
      last[1] = last[1] === null || to === null ? null : Math.max(last[1], to)
      continue
    }
    out.push([from, to])
  }
  return out
}

/**
 * An agent's runs (absolute times): those that ended before it ran again
 * (its lane's), then its run now, from its spawn or the moment it ran again
 * to its end; to now while it is at work. Undefined ends are not guessed:
 * a run with no end the deck saw ends where the deck last heard from it.
 */
function agentRunsOf(agent: DeckAgent): [number, number | null][] {
  const lane = agent.lane
  const from = lane?.woke ?? agent.resumedAt ?? agent.startedAt
  const isLive = M.isLive(agent.status)
  const to = isLive ? null : (agent.endedAt ?? Math.max(from, agent.lastAt))
  return joined([...(lane?.runs ?? []), [from, to]])
}

/** The Orchestrator's turns (absolute times): those that ended, then the one running (to now). */
function turnsOf(data: DeckData, main: DeckAgent): [number, number | null][] {
  const running: [number, number | null][] = data.mainTurnId !== undefined && data.mainTurnAt !== undefined ? [[data.mainTurnAt, null]] : []
  return joined([...(main.lane?.runs ?? []), ...running])
}

/**
 * An agent's waits on you (absolute times), each from a need raised to its
 * end: one still open runs to now only while the deck still holds it (the
 * call still held, the notification still noted); one whose end never came
 * (a reload lost it) is left out.
 */
function waitsOf(data: DeckData, agent: DeckAgent): [number, number | null][] {
  const out: [number, number | null][] = []
  for (const wait of agent.lane?.waits ?? []) {
    if (wait.to !== undefined) {
      out.push([wait.from, wait.to])
      continue
    }
    const isHeld =
      wait.kind === 'held'
        ? data.pending.some(item => item.id === wait.call && item.agentId === agent.id)
        : data.needs.some(note => (note.agent ?? M.MAIN) === agent.id && note.call === wait.call)
    if (isHeld) out.push([wait.from, null])
  }
  return joined(out)
}

/** What a call was given, verbatim: a shell's command, else its target; cut for the timeline. */
function callText(call: DeckActivity): string {
  return F.trunc(F.oneLine(call.command || call.target), TIMELINE_TEXT)
}

/** An agent's tool calls (absolute starts): its lane's, each of its newest 14 with its words, oldest first. */
function callsOf(agent: DeckAgent): { at: number; ms: number; tool: string; how: number; text?: string }[] {
  const lane = agent.lane
  const out = (lane?.calls ?? []).map(([at, ms, tool, how]) => ({ at: lane!.t0 + at, ms, tool: lane!.tools[tool] ?? '', how }) as { at: number; ms: number; tool: string; how: number; text?: string })
  for (const call of agent.recent) {
    const ms = call.ms ?? -1
    const how = call.ok === undefined ? -1 : call.ok ? 1 : 0
    const known = out.find(one => one.at === call.at && one.tool === call.tool)
    if (known) {
      known.text = callText(call)
      if (known.ms < 0 && ms >= 0) known.ms = ms
      if (known.how < 0) known.how = how
    } else {
      out.push({ at: call.at, ms, tool: call.tool, how, text: callText(call) })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

/**
 * The background tasks' lanes, as they started: each task the deck saw its
 * call start (a shell, a monitor, a workflow, a background agent), under the
 * loop that made that call. One on the Dashboard's Background
 * (`background.rows`) runs to now; one that ended, as the starter's lane
 * kept it (`DeckLane.background`, of the loops in `loops`), to the moment
 * Claude Code said it ended. A task first seen in Claude Code's snapshot
 * has no known start and gets no lane; the schedules (crons, wakeups) are
 * not lanes.
 */
export function backgroundLanesOf(data: DeckData, state: WebStateV2, loops: readonly string[]): { id: string; title: string; what: string; by: string; startedAt: number; endedAt: number | null }[] {
  const words = (text: string) => F.trunc(F.oneLine(text), TIMELINE_TEXT)
  const running = (state.background?.rows ?? [])
    .filter(row => row.kind !== 'cron' && row.kind !== 'wakeup' && row.by !== null && Number.isFinite(row.at) && row.title.trim() !== '')
    .map(row => ({ id: row.id, title: words(row.title), what: words(row.what), by: row.by as string, startedAt: row.at, endedAt: null as number | null }))
  const ended = loops.flatMap(id =>
    (M.agentOf(data, id)?.lane?.background ?? []).filter(one => one.title.trim() !== '').map(one => ({ id: one.id, title: words(one.title), what: words(one.what), by: id, startedAt: one.from, endedAt: one.to as number | null })),
  )
  return [...running, ...ended].sort((a, b) => a.startedAt - b.startedAt)
}

/** The first line of a chat row's words, cut for a mark or a message. */
function firstLineOf(text: string): string {
  return F.trunc(F.oneLine(F.firstLine(text)), TIMELINE_TEXT)
}

/**
 * Org's Timeline of the deck's model `data` as the v2 `state` (built from
 * it at `state.now`) shows it: a lane each agent row shown, in the tree's
 * order, its runs, waits, idle stretches, calls and outcome; your prompts
 * on the Orchestrator's lane; the messages between agents; the background
 * tasks, each by the lane that started it.
 */
export function timelineOf(data: DeckData, state: WebStateV2): V2Timeline {
  const now = state.now
  const tools: string[] = []
  const toolOf = (name: string) => {
    let at = tools.indexOf(name)
    if (at < 0) at = tools.push(name) - 1
    return at
  }
  type Built = Omit<V2Lane, 'start' | 'end' | 'spans' | 'ticks'> & { start: number; end: number | null; spans: V2Span[]; ticks: { at: number; ms: number; tool: string; how: number; text?: string }[] }
  const built: Built[] = []
  for (const { row, depth, parent } of laneRowsOf(state)) {
    const agent = M.agentOf(data, row.id)
    if (!agent) continue
    const isMain = agent.kind === 'main'
    const runs = isMain ? turnsOf(data, agent) : agentRunsOf(agent)
    const calls = callsOf(agent)
    const waits = waitsOf(data, agent)
    const spans: V2Span[] = runs.map(([from, to]) => ({ kind: 'work', from, to }))
    // idle: between two runs the deck saw both of
    for (let i = 1; i < runs.length; i++) {
      const before = runs[i - 1]
      const after = runs[i]
      if (before && after && before[1] !== null && after[0] > before[1]) spans.push({ kind: 'idle', from: before[1], to: after[0] })
    }
    const last = runs[runs.length - 1]
    // after the last run, to now: the Orchestrator between turns, an idle teammate (Claude Code said it went idle)
    const isIdleNow = last !== undefined && last[1] !== null && (isMain ? data.mainTurnId === undefined && (agent.lane?.runs.length ?? 0) > 0 : agent.status === 'idle')
    if (isIdleNow && last && last[1] !== null) spans.push({ kind: 'idle', from: last[1], to: null })
    const first = runs[0]
    const start = isMain ? Math.min(first?.[0] ?? Infinity, calls[0]?.at ?? Infinity, waits[0]?.[0] ?? Infinity) : agent.startedAt
    const lastEnd = last ? last[1] : null
    const end = isMain || isIdleNow || M.isLive(agent.status) || last === undefined ? null : lastEnd
    for (const [from, to] of waits) spans.push({ kind: 'wait', from, to: end !== null && to === null ? end : to })
    const order = { work: 0, idle: 1, wait: 2 }
    spans.sort((a, b) => order[a.kind] - order[b.kind] || a.from - b.from)
    const outcome = isMain ? null : row.isStopped ? 'stopped' : row.status === 'done' ? 'done' : row.status === 'failed' ? 'failed' : null
    built.push({ id: row.id, title: row.title, parent, depth, kind: row.kind, status: row.status, isStopped: row.isStopped, start: Number.isFinite(start) ? start : agent.startedAt, end, outcome, spans, ticks: calls })
  }
  const shown = new Set(built.map(lane => lane.id))
  const marks = state.chat.filter(row => row.from === M.YOU && row.to === M.MAIN && (row.kind === 'prompt' || row.kind === 'chat') && !row.isCleared).map(row => ({ at: row.at, id: row.id, text: firstLineOf(row.text) }))
  const messages = state.chat
    .filter(row => row.kind === 'message' && row.to !== null && shown.has(row.from) && shown.has(row.to) && row.from !== row.to && !row.isCleared)
    .map(row => ({ at: row.at, from: row.from, to: row.to as string, id: row.id, title: row.title ? F.trunc(F.oneLine(row.title), TIMELINE_TEXT) : firstLineOf(row.text) }))
  const background = backgroundLanesOf(data, state, [...shown])
  const starts = [...built.map(lane => lane.start), ...background.map(one => one.startedAt), ...marks.map(one => one.at)].filter(Number.isFinite)
  const startedAt = Math.min(now, ...starts)
  const off = (at: number) => at - startedAt
  const offOrNull = (at: number | null) => (at === null ? null : at - startedAt)
  return {
    v: 2,
    now,
    startedAt,
    tools,
    lanes: built.map(lane => ({
      id: lane.id,
      title: lane.title,
      parent: lane.parent,
      depth: lane.depth,
      kind: lane.kind,
      status: lane.status,
      isStopped: lane.isStopped,
      start: off(lane.start),
      end: offOrNull(lane.end),
      outcome: lane.outcome,
      spans: lane.spans.map(span => ({ kind: span.kind, from: off(span.from), to: offOrNull(span.to) })),
      ticks: lane.ticks.map((call): V2Tick => (call.text !== undefined ? [off(call.at), call.ms, toolOf(call.tool), call.how, call.text] : [off(call.at), call.ms, toolOf(call.tool), call.how])),
    })),
    marks: marks.map(mark => ({ ...mark, at: off(mark.at) })),
    messages: messages.map(message => ({ ...message, at: off(message.at) })),
    background: background.map(one => ({ id: one.id, title: one.title, what: one.what, by: one.by, start: off(one.startedAt), end: offOrNull(one.endedAt) })),
  }
}

/** The timeline as timeline.json holds it: one line of JSON and a newline. */
export function timelineTextOf(timeline: V2Timeline): string {
  return `${JSON.stringify(timeline)}\n`
}

/** A timeline read from timeline.json, its times moved by `by` ms (as the sample's state was); null for text that is no timeline. */
export function timelineFromText(text: string, by = 0): V2Timeline | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const one = value as Record<string, unknown>
  if (one.v !== 2 || typeof one.now !== 'number' || typeof one.startedAt !== 'number' || !Array.isArray(one.lanes) || !Array.isArray(one.tools)) return null
  const timeline = value as V2Timeline
  return { ...timeline, now: timeline.now + by, startedAt: timeline.startedAt + by, marks: Array.isArray(timeline.marks) ? timeline.marks : [], messages: Array.isArray(timeline.messages) ? timeline.messages : [], background: Array.isArray(timeline.background) ? timeline.background : [] }
}
