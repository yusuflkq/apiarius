/**
 * Org's Timeline as every surface lays it out: the rows (each agent, the
 * shells it started under it), the
 * axis folded where nobody worked, the words on that axis, a lane's calls as
 * segments, and where the messages between agents cross the rows. The web
 * page imports it as it is; the mod lays the Desktop pane's and the
 * terminal's out with it (hooks/ui/v2/timeline.tsx), through timeline.d.mts.
 *
 * Every time is ms after the timeline's `startedAt`; every place is in the
 * caller's units across its room: px on the page and the pane, cells on the
 * terminal.
 *
 * Pure, and it imports nothing.
 */

/** A stretch this long or longer where nobody worked folds to a break on the axis. */
export const FOLD_MS = 20 * 60_000

/** Calls of one tool closer together than this are one segment. */
export const GROUP_MS = 40_000

/** Where somebody worked or waited on you, `[from, to]`, joined where they touch: every lane's stretches but idle (one to now runs to `span`). */
export function busyOf(lanes, span) {
  const runs = []
  for (const lane of lanes) {
    for (const one of lane.spans) {
      if (one.kind === 'idle') continue
      const from = Math.max(0, one.from)
      const to = Math.min(span, one.to == null ? span : one.to)
      if (to >= from) runs.push([from, to])
    }
  }
  runs.sort((a, b) => a[0] - b[0])
  const out = []
  for (const [from, to] of runs) {
    const last = out[out.length - 1]
    if (last && from <= last[1]) last[1] = Math.max(last[1], to)
    else out.push([from, to])
  }
  return out
}

/** The stretches where nobody worked, `min` long or longer, oldest first: between two runs of work, and after the last up to now; none while nobody has worked. */
export function foldsOf(lanes, span, min = FOLD_MS) {
  const busy = busyOf(lanes, span)
  if (busy.length === 0) return []
  const out = []
  let at = 0
  for (const [from, to] of busy) {
    if (from - at >= min) out.push({ from: at, to: from })
    at = Math.max(at, to)
  }
  if (span - at >= min) out.push({ from: at, to: span })
  return out
}

/**
 * The axis `room` across over `span` ms: time runs evenly over it but for
 * each fold, a break `gap` across (the breaks take a third of the room at
 * most). `x(ms)` is where a time sits; each fold keeps where its break is
 * (`x0`, `x1`). With nothing open between the folds, nothing folds.
 */
export function axisOf(span, folds, room, gap) {
  const folded = folds.reduce((sum, one) => sum + (one.to - one.from), 0)
  const kept = folded < span ? folds : []
  const brk = kept.length > 0 ? Math.min(gap, room / 3 / kept.length) : 0
  const open = span - (kept === folds ? folded : 0)
  const per = (room - brk * kept.length) / Math.max(1, open)
  const x = ms => {
    const at = Math.min(span, Math.max(0, ms))
    let px = 0
    let last = 0
    for (const one of kept) {
      if (at <= one.from) return px + (at - last) * per
      px += (one.from - last) * per
      if (at < one.to) return px + ((at - one.from) / (one.to - one.from)) * brk
      px += brk
      last = one.to
    }
    return px + (at - last) * per
  }
  return { span, room, gap: brk, per, folds: kept.map(one => ({ from: one.from, to: one.to, x0: x(one.from), x1: x(one.to) })), x }
}

/** Whether time `ms` lies inside one of the axis's folds. */
export function isFolded(axis, ms) {
  return axis.folds.some(one => ms > one.from && ms < one.to)
}

const pad2 = n => String(n).padStart(2, '0')

/** A time of day on this machine's clock, "16:30". */
export function clockOf(at) {
  const d = new Date(at)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** How long a fold is: "2h 50m", "45m". */
export function lengthOf(ms) {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  return m % 60 === 0 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** The clock steps the axis's round times pick from, minutes. */
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]

/**
 * The words the axis carries, never one over another, each `{ x, text,
 * align, kind }` (`align` 'start', 'middle' or 'end' of the words at `x`):
 * in turn "now" at its end; each fold's length on its break ("⋯ 2h 50m");
 * the clock time it starts at; the times either side of each break; then
 * the round clock times between (every 5, 15 or 30 minutes, an hour…,
 * whichever leaves `gap` between their words). `widthOf(text)` is how wide
 * words are in the axis's units; `fold` the mark a break's words lead with
 * (null: a break carries no words, where its length is said elsewhere).
 */
export function axisWordsOf(axis, startedAt, widthOf, gap, fold = '⋯ ') {
  const taken = []
  const out = []
  const place = (x, text, align, kind) => {
    const w = widthOf(text)
    let left = align === 'start' ? x : align === 'end' ? x - w : x - w / 2
    if (left < 0) left = 0
    if (left + w > axis.room) left = axis.room - w
    if (left < 0) return false
    if (taken.some(([a, b]) => left < b + gap && left + w + gap > a)) return false
    taken.push([left, left + w])
    out.push({ x: align === 'start' ? left : align === 'end' ? left + w : left + w / 2, text, align, kind })
    return true
  }
  place(axis.room, 'now', 'end', 'now')
  if (fold !== null) for (const one of axis.folds) place((one.x0 + one.x1) / 2, `${fold}${lengthOf(one.to - one.from)}`, 'middle', 'fold')
  if (!axis.folds.some(one => one.from === 0)) place(0, clockOf(startedAt), 'start', 'start')
  for (const one of axis.folds) {
    if (one.from > 0) place(one.x0, clockOf(startedAt + one.from), 'end', 'edge')
    if (one.to < axis.span) place(one.x1, clockOf(startedAt + one.to), 'start', 'edge')
  }
  const wide = widthOf('00:00') + gap
  const step = (STEPS.find(m => m * 60_000 * axis.per >= wide) ?? STEPS[STEPS.length - 1]) * 60_000
  const shift = new Date(startedAt).getTimezoneOffset() * -60_000
  for (let ms = Math.ceil((startedAt + shift) / step) * step - shift - startedAt; ms < axis.span; ms += step) {
    if (ms <= 0 || isFolded(axis, ms) || axis.folds.some(one => one.from === ms || one.to === ms)) continue
    place(axis.x(ms), clockOf(startedAt + ms), 'middle', 'tick')
  }
  return out.sort((a, b) => a.x - b.x)
}

/**
 * The rows the chart draws, in order: each lane, then the background lanes
 * its loop started (`by`), as they started; those whose starter is not
 * drawn after the lanes. Each `{ kind: 'lane', lane }` or `{ kind: 'bg', bg }`.
 */
export function rowsOf(lanes, background) {
  const drawn = new Set(lanes.map(lane => lane.id))
  const under = new Map()
  const loose = []
  for (const bg of [...background].sort((a, b) => a.start - b.start)) {
    if (bg.by != null && drawn.has(bg.by)) under.set(bg.by, [...(under.get(bg.by) || []), bg])
    else loose.push(bg)
  }
  const out = []
  for (const lane of lanes) {
    out.push({ kind: 'lane', lane })
    for (const bg of under.get(lane.id) || []) out.push({ kind: 'bg', bg })
  }
  for (const bg of loose) out.push({ kind: 'bg', bg })
  return out
}

/** The lanes drawn when at most `most` are: the Orchestrator and the newest to start, in their own order; and how many are left out. */
export function newestOf(lanes, most) {
  if (lanes.length <= most) return { lanes, more: 0 }
  const keep = new Set(
    lanes
      .filter(lane => lane.id !== 'main')
      .sort((a, b) => b.start - a.start)
      .slice(0, Math.max(0, most - (lanes.some(lane => lane.id === 'main') ? 1 : 0)))
      .map(lane => lane.id),
  )
  const shown = lanes.filter(lane => lane.id === 'main' || keep.has(lane.id))
  return { lanes: shown, more: lanes.length - shown.length }
}

/**
 * A lane's calls as the segments it draws, oldest first, each `{ from, to,
 * x0, x1, tool, count, tools, failed, running }`. Calls of one tool back to
 * back (under GROUP_MS apart, or touching where they are drawn) are one
 * segment with their count; a failed call is one of its own. A segment is
 * `min` across at least, and those closer than `join` to the one before it
 * are one segment (`tool` '' when they hold more than one tool, `tools`
 * each tool's count). A call whose end was not seen ends where it began,
 * but the lane's newest runs to `liveTo` while the lane is at work.
 *
 * `calls` are `{ at, ms, tool, how }`, oldest first: `ms` -1 for an end not
 * seen, `how` 1 ok, 0 failed, -1 not known.
 */
export function segmentsOf(calls, axis, { liveTo = null, min = 2, join = 2 } = {}) {
  const grouped = []
  calls.forEach((call, i) => {
    const running = call.ms < 0 && liveTo != null && i === calls.length - 1
    const from = call.at
    const to = call.ms >= 0 ? call.at + call.ms : running ? liveTo : call.at
    const x0 = axis.x(from)
    const x1 = Math.max(axis.x(to), x0 + min)
    const failed = call.how === 0
    const last = grouped[grouped.length - 1]
    if (last && !failed && !last.failed && last.tool === call.tool && (from - last.to < GROUP_MS || x0 - last.x1 < join)) {
      last.to = Math.max(last.to, to)
      last.x1 = Math.max(last.x1, x1)
      last.count += 1
      last.tools[call.tool] = (last.tools[call.tool] || 0) + 1
      last.running = last.running || running
      return
    }
    grouped.push({ from, to, x0, x1, tool: call.tool, count: 1, tools: { [call.tool]: 1 }, failed, running })
  })
  const out = []
  for (const one of grouped) {
    const last = out[out.length - 1]
    if (last && !one.failed && !last.failed && one.x0 - last.x1 < join) {
      last.to = Math.max(last.to, one.to)
      last.x1 = Math.max(last.x1, one.x1)
      last.count += one.count
      for (const [tool, n] of Object.entries(one.tools)) last.tools[tool] = (last.tools[tool] || 0) + n
      if (last.tool !== one.tool) last.tool = ''
      last.running = last.running || one.running
      continue
    }
    out.push({ ...one, tools: { ...one.tools } })
  }
  return out
}

/**
 * What a segment `w` across says: its tool ("Read ×10" with `rich`, for ten
 * calls), or for one of more tools the tool that holds more than half its
 * calls (and their count), where that fits with `pad` beside it; '' where
 * nothing fits, or no tool holds more than half.
 */
export function segmentLabel(segment, w, widthOf, rich = false, pad = 0) {
  const top = Object.entries(segment.tools).sort((a, b) => b[1] - a[1])[0]
  const tool = segment.tool || (top && top[1] * 2 > segment.count ? top[0] : '')
  if (!tool) return ''
  const count = segment.tool ? segment.count : top[1]
  const full = rich && count > 1 ? `${tool} ×${count}` : tool
  if (widthOf(full) + pad <= w) return full
  return full !== tool && widthOf(tool) + pad <= w ? tool : ''
}

/** "Edit ×6, Read ×3": what a segment holds, the most used tool first. */
export function toolsText(segment) {
  return Object.entries(segment.tools)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, n]) => (n > 1 ? `${tool} ×${n}` : tool))
    .join(', ')
}

/**
 * Where the messages cross the rows: for each row (`ids`, in drawn order),
 * the messages whose arrow touches it, each `{ at, n, role, down }`: `n` its
 * number (1 for the oldest drawn), `role` 'from' on its sender's row (the
 * arrow leaves it), 'to' on its receiver's (the arrow ends there), 'pass' on
 * a row between; `down` whether the receiver is drawn below the sender. A
 * message to or from a row not drawn is left out and takes no number.
 */
export function crossingsOf(ids, messages) {
  const out = ids.map(() => [])
  for (const one of numberedOf(ids, messages)) {
    const a = ids.indexOf(one.from)
    const b = ids.indexOf(one.to)
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out[i].push({ at: one.at, n: one.n, role: i === a ? 'from' : i === b ? 'to' : 'pass', down: b > a })
  }
  return out
}

/** The messages drawn, oldest first, each numbered (`n`, from 1): those between two rows drawn. */
export function numberedOf(ids, messages) {
  const out = []
  for (const one of messages) {
    const a = ids.indexOf(one.from)
    const b = ids.indexOf(one.to)
    if (a < 0 || b < 0 || a === b) continue
    out.push({ ...one, n: out.length + 1 })
  }
  return out
}
