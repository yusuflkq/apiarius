/**
 * The timeline's own records (Org's Timeline, ./timeline): what the model's
 * fields let go of, kept per loop on its agent (`DeckAgent.lane`), every
 * time one Claude Code reported:
 *
 * - each tool call's start, its length and how it went, the newest 400 (the
 *   model keeps only the newest 14 whole, `recent`);
 * - the runs it ended before it ran again (a message woke it, a teammate's
 *   next turn), and the Orchestrator's turns as they ended;
 * - its waits on you: from a call held on you (a question, a permission
 *   prompt) or Claude Code's notification, to the moment the deck's own need
 *   went (the call's end; for a notification, its loop moving on, as
 *   `M.clearNeeds` takes it down).
 *
 * The model's recorders call these (./model: `beginTool`, `endTool`,
 * `reopen`, `noteSpawn`, `noteMainTurn`, `endMainTurn`, `notePending`,
 * `noteNeeds`), so the hooks module and the recorded sample both keep them.
 * Pure, and it imports nothing but types, so the model can import it.
 */
import type { DeckActivity, DeckAgent, DeckData, DeckLane } from '../types'

/** What a lane keeps at most: its calls, its ended runs, its waits, the tools its calls name. */
export const LANE_CAPS = { calls: 400, runs: 100, waits: 100, tools: 200 } as const

/** Agent `agent`'s lane, made on first use. */
function laneOf(agent: DeckAgent): DeckLane {
  agent.lane ??= { t0: 0, tools: [], calls: [], runs: [], waits: [] }
  return agent.lane
}

/** Whether a loop has a lane: the Orchestrator, its agents and teammates; never you or a peer of earlier builds. */
function hasLane(agent: DeckAgent | undefined): agent is DeckAgent {
  return agent !== undefined && agent.kind !== 'you' && agent.kind !== 'peer'
}

/** Keeps the newest `most` of `list`. */
function capped<T>(list: T[], most: number): void {
  if (list.length > most) list.splice(0, list.length - most)
}

/** A run that ended, `[from, to]`, once: none that ended before it began, and not the same run twice. */
function pushRun(lane: DeckLane, from: number, to: number): void {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return
  const last = lane.runs[lane.runs.length - 1]
  if (last && last[0] === from && last[1] === to) return
  lane.runs.push([from, to])
  capped(lane.runs, LANE_CAPS.runs)
}

/** Ends, at `at`, every wait of `lane` still open that `isOver` picks. */
function endWaits(lane: DeckLane, at: number, isOver: (wait: DeckLane['waits'][number]) => boolean): void {
  for (const wait of lane.waits) if (wait.to === undefined && isOver(wait)) wait.to = Math.max(wait.from, at)
}

/**
 * A call started in `agent`'s loop (`M.beginTool`): its tick, and the
 * notifications that waited on that loop answered (it moved on, as
 * `M.clearNeeds` `start` takes them down). An idle agent at work again (a
 * teammate's next turn) ran again from then.
 */
export function noteCall(agent: DeckAgent, call: DeckActivity): void {
  if (!hasLane(agent)) return
  if (agent.kind !== 'main' && agent.status === 'idle') noteWake(agent, call.at)
  const lane = laneOf(agent)
  if (lane.calls.length === 0) lane.t0 = call.at
  let tool = lane.tools.indexOf(call.tool)
  if (tool < 0 && lane.tools.length < LANE_CAPS.tools) tool = lane.tools.push(call.tool) - 1
  lane.calls.push([call.at - lane.t0, -1, Math.max(0, tool), -1])
  capped(lane.calls, LANE_CAPS.calls)
  endWaits(lane, call.at, wait => wait.kind === 'note')
}

/**
 * A call of `agent`'s ended (`M.endTool`): `started` is its record (the
 * newest 14 hold it), so its tick gets its length and how it went. A call
 * held on you ends with it (your answer, the call run or refused), and so
 * does a notification about it; one about no call in particular ends at
 * any call's end of that loop (`M.clearNeeds` `end`).
 */
export function noteCallEnd(agent: DeckAgent, id: string, started: DeckActivity | undefined, ok: boolean, now: number): void {
  if (!hasLane(agent) || !agent.lane) return
  const lane = agent.lane
  if (started) {
    const at = started.at - lane.t0
    const tool = lane.tools.indexOf(started.tool)
    for (let i = lane.calls.length - 1; i >= 0; i--) {
      const tick = lane.calls[i]
      if (tick && tick[0] === at && tick[1] < 0 && (tool < 0 || tick[2] === tool)) {
        tick[1] = Math.max(0, now - started.at)
        tick[3] = ok ? 1 : 0
        break
      }
    }
  }
  endWaits(lane, now, wait => wait.call === id || (wait.kind === 'note' && wait.call === undefined))
}

/**
 * `agent` ran again at `at` after its run ended (its `endedAt`: done,
 * failed, stopped or idle), before the model forgets that end (`M.reopen`,
 * a spawn of a known agent): the run that ended is kept, and its new one
 * starts at `at`.
 */
export function noteWake(agent: DeckAgent, at: number): void {
  if (!hasLane(agent) || agent.kind === 'main') return
  const end = agent.endedAt
  if (end === undefined) return
  const lane = laneOf(agent)
  pushRun(lane, lane.woke ?? agent.resumedAt ?? agent.startedAt, end)
  lane.woke = Math.max(at, end)
}

/**
 * The main loop's turn starts at `at` (`M.noteMainTurn`, before it takes the
 * turn's place): a turn still open whose end never came ran until the deck
 * last heard from the Orchestrator; the notifications that waited on the
 * Orchestrator are answered (`M.clearNeeds` `turn`).
 */
export function noteTurnStart(data: DeckData, main: DeckAgent | undefined, at: number): void {
  if (!hasLane(main)) return
  const lane = laneOf(main)
  if (data.mainTurnAt !== undefined) pushRun(lane, data.mainTurnAt, Math.min(at, Math.max(data.mainTurnAt, main.lastAt)))
  endWaits(lane, at, wait => wait.kind === 'note')
}

/** The main loop's running turn ended at `at` (`M.endMainTurn`), else when the deck last heard from the Orchestrator: one turn more. */
export function noteTurnEnd(data: DeckData, main: DeckAgent | undefined, at: number | undefined): void {
  if (!hasLane(main) || data.mainTurnAt === undefined) return
  pushRun(laneOf(main), data.mainTurnAt, at ?? Math.max(data.mainTurnAt, main.lastAt))
}

/**
 * Something of `agent`'s waits on you from `from`: a call held on you
 * (`held`, by its call: `M.notePending`) or Claude Code's notification
 * (`note`, with the call it is about when told: `M.noteNeeds`). The same
 * wait noted again while it lasts is one.
 */
export function noteWait(agent: DeckAgent | undefined, wait: { kind: 'held' | 'note'; from: number; call?: string }): void {
  if (!hasLane(agent)) return
  const lane = laneOf(agent)
  if (lane.waits.some(one => one.to === undefined && one.kind === wait.kind && one.call === wait.call)) return
  lane.waits.push({ kind: wait.kind, from: wait.from, ...(wait.call !== undefined ? { call: wait.call } : {}) })
  capped(lane.waits, LANE_CAPS.waits)
}

/** A twin row's lane folded into the row that stays (`M.bindAgent`): every call, run and wait of both, oldest first. */
export function mergeLanes(row: DeckAgent, twin: DeckAgent): void {
  const from = twin.lane
  if (!from) return
  const into = row.lane
  if (!into) {
    row.lane = from
    return
  }
  const t0 = Math.min(into.t0, from.t0)
  const tools = [...into.tools]
  const ticks = (lane: DeckLane) =>
    lane.calls.map(([at, ms, tool, how]): [number, number, number, number] => {
      const name = lane.tools[tool] ?? ''
      let place = tools.indexOf(name)
      if (place < 0) place = tools.push(name) - 1
      return [at + lane.t0 - t0, ms, place, how]
    })
  const calls = [...ticks(into), ...ticks(from)].sort((a, b) => a[0] - b[0])
  capped(calls, LANE_CAPS.calls)
  const runs = [...into.runs, ...from.runs].sort((a, b) => a[0] - b[0])
  capped(runs, LANE_CAPS.runs)
  const waits = [...into.waits, ...from.waits].sort((a, b) => a.from - b.from)
  capped(waits, LANE_CAPS.waits)
  const woke = Math.max(into.woke ?? 0, from.woke ?? 0)
  row.lane = { t0, tools, calls, runs, waits, ...(woke > 0 ? { woke } : {}) }
}

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** A restored agent's lane, each part kept only in its own shape (and to its cap); none at all when it is no lane. */
export function healLane(agent: DeckAgent): void {
  const lane = agent.lane as unknown
  if (lane === undefined) return
  const loose = typeof lane === 'object' && lane !== null ? (lane as Record<string, unknown>) : null
  if (!loose || !isTime(loose.t0) || !Array.isArray(loose.tools) || !Array.isArray(loose.calls) || !Array.isArray(loose.runs) || !Array.isArray(loose.waits)) {
    delete agent.lane
    return
  }
  const tools = loose.tools.filter((one): one is string => typeof one === 'string').slice(0, LANE_CAPS.tools)
  const calls = loose.calls.filter((one): one is [number, number, number, number] => Array.isArray(one) && one.length === 4 && one.every(isTime)).slice(-LANE_CAPS.calls)
  const runs = loose.runs.filter((one): one is [number, number] => Array.isArray(one) && one.length === 2 && one.every(isTime)).slice(-LANE_CAPS.runs)
  const waits = loose.waits
    .filter((one): one is DeckLane['waits'][number] => {
      if (typeof one !== 'object' || one === null) return false
      const wait = one as Record<string, unknown>
      return (wait.kind === 'held' || wait.kind === 'note') && isTime(wait.from) && (wait.to === undefined || isTime(wait.to)) && (wait.call === undefined || typeof wait.call === 'string')
    })
    .slice(-LANE_CAPS.waits)
  agent.lane = { t0: loose.t0, tools, calls, runs, waits, ...(isTime(loose.woke) ? { woke: loose.woke } : {}) }
}
