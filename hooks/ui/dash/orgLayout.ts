/**
 * The Org tab's chart in cells: where each agent's card sits and the
 * box-drawing connectors between them. It is the web deck's tree
 * (web/app.js `layoutOrg`), fitted to a pane 68 to 84 columns wide:
 *
 * - the Orchestrator at the top, its agents below, nested agents under their parent;
 * - a parent's children wrap into rows when one row is wider than the pane,
 *   the leaves first, and the trunk runs down a gap, never through a card;
 * - a chart still too wide starts at the Orchestrator, and the person pans.
 *
 * Pure: no `$`, nothing of the engine's. The surface module (./org.client.tsx)
 * draws it on the drawing thread; the deck's views make its props, and size
 * its Client, with `orgPropsOf`.
 */

export type OrgStatus = 'starting' | 'running' | 'waiting' | 'done' | 'failed' | 'idle'

/** One agent as the Client's props carry it (the web state's agent, cut down to what a card shows). */
export type OrgAgent = {
  id: string
  label: string
  type: string
  /** Short: 'opus-5.5'. */
  model: string
  /** Already formatted ('48k'), '' for none. */
  tokens: string
  status: OrgStatus
  /** The one line: its current step, last action or result. */
  now: string
  /** null for a root: the Orchestrator, or an agent whose parent is not in the list. */
  parent: string | null
}

/**
 * The Client's props, as `orgPropsOf` makes them: the agents, the one
 * selected, and the region the deck's views gave the Client.
 */
export type OrgProps = {
  agents: OrgAgent[]
  selected: string | null
  /**
   * The rows the Client's region takes (its `height`): what the chart draws
   * to. Never `surface.rows`, which on the desktop is how tall the instance
   * last drew (1 on a fresh mount), not how tall its region is.
   */
  rows?: number
  /** The columns the views laid the chart out in to size those rows: the chart lays out in them too. */
  columns?: number
  /** Agents left out of `agents` (past MAX_AGENTS), shown as "+N more". */
  more?: number
}

/** A card's cells across and down: a round border around four lines (name, type, model and tokens, now). */
export const CARD_W = 25
export const CARD_H = 6
/** Cells between sibling subtrees: the trunk runs down the middle one of a wrapped row's gap. */
export const GAP_X = 3
/** Rows between a card and the row of cards under it: the stem, then the bus. */
export const GAP_Y = 2
/** Cells between two separate trees (the Orchestrator's and a peer's). */
export const ROOT_GAP = 6
/** The most cards drawn; the rest show as "+N more". */
export const MAX_AGENTS = 60
/** The most rows the deck's views give the Client. */
export const MAX_ROWS = 40
/** The most characters a string of an agent's props keeps: more than a card shows, so the props stay small. */
export const PROP_TEXT = 48
/**
 * The most elements one drawing of the chart holds, its strings counted as
 * the desktop counts them: the desktop draws nothing of a tree of 2000 or
 * more. A card past it is left out and counted in "+N more".
 */
export const MAX_NODES = 1200
/**
 * What each part of a drawing costs in that count: the frame (the region,
 * the chart and the note), a card, a card clipped at the chart's bottom edge,
 * a stretch of `─` clipped to its cells, one glyph, a run down.
 */
export const NODES = { frame: 4, card: 12, cutCard: 13, stretch: 4, glyph: 3, down: 3 } as const
/** Columns inside a card's border and its one cell of padding each side. */
export const CARD_TEXT = CARD_W - 4

/** A card's centre column, from its left edge (CARD_W is odd: a true centre). */
const HALF = (CARD_W - 1) / 2

/** How lively a connector is: 2 leads to a running agent, 1 to a waiting one, 0 otherwise. */
export type OrgHeat = 0 | 1 | 2

export type OrgCard = {
  agent: OrgAgent
  /** The card's top-left cell in the chart. */
  x: number
  y: number
  /** 0 for a root. */
  depth: number
}

/**
 * A run of connector glyphs in one colour: across from its first cell, or
 * down from it when `down` (one glyph a row).
 */
export type OrgSegment = { x: number; y: number; glyphs: string; down: boolean; heat: OrgHeat }

export type OrgLayout = {
  /** The chart's cells across and down. */
  width: number
  height: number
  /** In tree order: a parent before its children. */
  cards: OrgCard[]
  segments: OrgSegment[]
  /** Agents past MAX_AGENTS, left out. */
  hidden: number
  /** The Orchestrator's centre column (the first root's): where a chart wider than its region starts. */
  focus: number
}

/** Where the chart sits in a Client's region, and what the line under it says. */
export type OrgView = {
  /** Where the chart's cell (0, 0) lands in the region. */
  x: number
  y: number
  /** The region's columns, and the rows the chart shows in (the note's row left out). */
  columns: number
  rows: number
  /** The pan as clamped: what the input handlers keep. */
  panX: number
  panY: number
  /** The dim line under the chart ('+3 more', how to pan), '' for none. */
  note: string
}

// ------------------------------------------------------------- the agents

const STATUSES: readonly OrgStatus[] = ['starting', 'running', 'waiting', 'done', 'failed', 'idle']

const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

/**
 * The agents as the chart reads them: each an object with a non-empty string
 * id, the first of an id kept, every field a string and an unknown status
 * idle. Props come from another thread as plain data: nothing is trusted.
 */
export function orgAgentsOf(raw: unknown): OrgAgent[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: OrgAgent[] = []
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    const id = str(a.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const status = STATUSES.includes(a.status as OrgStatus) ? (a.status as OrgStatus) : 'idle'
    const parent = str(a.parent)
    out.push({ id, label: str(a.label), type: str(a.type), model: str(a.model), tokens: str(a.tokens), status, now: str(a.now), parent: parent || null })
  }
  return out
}

type Tree = { roots: OrgAgent[]; kids: Map<string, OrgAgent[]>; hidden: number }

/**
 * The tree the chart draws: roots first (the Orchestrator, `main`, before
 * the rest), each agent under its parent, in the order given. Walked breadth
 * first, so a cut at MAX_AGENTS keeps the upper levels whole and every kept
 * agent's parent. An agent caught in a parent cycle starts a tree of its own.
 */
function treeOf(agents: readonly OrgAgent[]): Tree {
  const byId = new Map(agents.map(a => [a.id, a]))
  const children = new Map<string, OrgAgent[]>()
  const tops: OrgAgent[] = []
  for (const a of agents) {
    const p = a.parent !== null && a.parent !== a.id && byId.has(a.parent) ? a.parent : null
    if (p === null) tops.push(a)
    else (children.get(p) ?? children.set(p, []).get(p)!).push(a)
  }
  tops.sort((x, y) => Number(y.id === 'main') - Number(x.id === 'main'))

  const seen = new Set<string>()
  const order: OrgAgent[] = []
  const roots: OrgAgent[] = []
  const kids = new Map<string, OrgAgent[]>()
  const walk = (start: readonly OrgAgent[]) => {
    const queue: OrgAgent[] = []
    for (const r of start) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      roots.push(r)
      order.push(r)
      queue.push(r)
    }
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i]!
      for (const k of children.get(a.id) ?? []) {
        if (seen.has(k.id)) continue
        seen.add(k.id)
        order.push(k)
        queue.push(k)
        const list = kids.get(a.id)
        if (list) list.push(k)
        else kids.set(a.id, [k])
      }
    }
  }
  walk(tops)
  for (const a of agents) if (!seen.has(a.id)) walk([a])

  if (order.length <= MAX_AGENTS) return { roots, kids, hidden: 0 }
  const kept = new Set(order.slice(0, MAX_AGENTS).map(a => a.id))
  for (const [id, list] of kids) kids.set(id, list.filter(k => kept.has(k.id)))
  return { roots: roots.filter(r => kept.has(r.id)), kids, hidden: order.length - kept.size }
}

// ------------------------------------------------------------- the layout

/** A subtree's bounding box: its size, and its root card's centre column from its left edge. */
type Measure = { w: number; h: number; cx: number; rows: Row[] }

/** A row of a parent's children: its left edge from the parent's centre column, its top from the parent's top. */
type Row = { kids: OrgAgent[]; start: number; top: number }

/**
 * The rows a wrapped level takes, `k` cards at most to a row: as even as the
 * count allows, any longer rows last (so the trunk passes the shorter ones),
 * and never a lone card in a row the trunk must pass.
 */
function groupsOf(order: readonly OrgAgent[], k: number): OrgAgent[][] {
  const n = order.length
  const count = Math.ceil(n / k)
  if (count <= 1) return [order.slice()]
  const base = Math.floor(n / count)
  const sizes: number[] = []
  if (base >= 2) {
    const extra = n % count
    for (let i = 0; i < count; i++) sizes.push(base + (i >= count - extra ? 1 : 0))
  } else {
    const per = Math.ceil(n / count)
    for (let left = n; left > 0; left -= per) sizes.push(Math.min(per, left))
  }
  const groups: OrgAgent[][] = []
  let at = 0
  for (const size of sizes) {
    groups.push(order.slice(at, at + size))
    at += size
  }
  return groups
}

/**
 * How far a row the trunk passes must move left so the trunk (column 0, the
 * parent's centre) runs down the middle of its nearest gap: never through a
 * card or a subtree. A lone box (not one `groupsOf` makes) goes right of it.
 */
function trunkShift(start: number, widths: readonly number[]): number {
  if (widths.length < 2) return start - (Math.floor(GAP_X / 2) + 1)
  let x = start
  let best: number | null = null
  for (let i = 0; i < widths.length - 1; i++) {
    x += widths[i]!
    const mid = x + Math.floor(GAP_X / 2)
    if (best === null || Math.abs(mid) < Math.abs(best)) best = mid
    x += GAP_X
  }
  return best ?? 0
}

/** A level laid out as these rows: each centred under the parent (a lone card right under it), the trunk kept clear. */
function rowsOf(groups: readonly OrgAgent[][], boxes: ReadonlyMap<string, Measure>): Measure {
  let lo = -HALF
  let hi = HALF
  let y = CARD_H + GAP_Y
  const rows: Row[] = []
  groups.forEach((list, ri) => {
    const widths = list.map(k => boxes.get(k.id)!.w)
    const span = widths.reduce((sum, w) => sum + w, 0) + GAP_X * (list.length - 1)
    let start = list.length === 1 ? -boxes.get(list[0]!.id)!.cx : -Math.floor(span / 2)
    if (ri < groups.length - 1) start -= trunkShift(start, widths)
    rows.push({ kids: list, start, top: y })
    lo = Math.min(lo, start)
    hi = Math.max(hi, start + span - 1)
    y += Math.max(...list.map(k => boxes.get(k.id)!.h)) + GAP_Y
  })
  return { w: hi - lo + 1, h: y - GAP_Y, cx: -lo, rows }
}

/**
 * Measures each subtree bottom up. A level wider than `budget` wraps into the
 * fewest rows that fit (its leaves first, the agents with subtrees last, so
 * the trunk stays short); when none fits, the narrowest, and the person pans.
 */
function measureAll(tree: Tree, budget: number): Map<string, Measure> {
  const boxes = new Map<string, Measure>()
  const measure = (a: OrgAgent) => {
    const kids = tree.kids.get(a.id) ?? []
    for (const k of kids) measure(k)
    if (kids.length === 0) {
      boxes.set(a.id, { w: CARD_W, h: CARD_H, cx: HALF, rows: [] })
      return
    }
    let best = rowsOf([kids], boxes)
    if (best.w > budget && kids.length > 2) {
      const isDeep = (k: OrgAgent) => (tree.kids.get(k.id) ?? []).length > 0
      const order = [...kids.filter(k => !isDeep(k)), ...kids.filter(isDeep)]
      let narrowest = best
      let fits = false
      for (let k = kids.length - 1; k >= 2 && !fits; k--) {
        const option = rowsOf(groupsOf(order, k), boxes)
        if (option.w <= budget) {
          best = option
          fits = true
        } else if (option.w < narrowest.w) narrowest = option
      }
      if (!fits) best = narrowest
    }
    boxes.set(a.id, best)
  }
  for (const r of tree.roots) measure(r)
  return boxes
}

const UP = 1
const DOWN = 2
const LEFT = 4
const RIGHT = 8

/** The light box-drawing glyphs, each with the strokes it draws. */
const SHAPES: readonly (readonly [string, number])[] = [
  ['│', UP | DOWN],
  ['─', LEFT | RIGHT],
  ['┌', DOWN | RIGHT],
  ['┐', DOWN | LEFT],
  ['└', UP | RIGHT],
  ['┘', UP | LEFT],
  ['├', UP | DOWN | RIGHT],
  ['┤', UP | DOWN | LEFT],
  ['┬', DOWN | LEFT | RIGHT],
  ['┴', UP | LEFT | RIGHT],
  ['┼', UP | DOWN | LEFT | RIGHT],
]

/** A cell's glyph by its strokes; a lone stroke draws as its straight line. */
const GLYPHS: Record<number, string> = Object.fromEntries([...SHAPES.map(([g, s]) => [s, g]), [UP, '│'], [DOWN, '│'], [LEFT, '─'], [RIGHT, '─']])

/** Each glyph's strokes: what a test walks the connectors by. */
export const GLYPH_STROKES: Readonly<Record<string, { up: boolean; down: boolean; left: boolean; right: boolean }>> = Object.fromEntries(
  SHAPES.map(([g, s]) => [g, { up: (s & UP) > 0, down: (s & DOWN) > 0, left: (s & LEFT) > 0, right: (s & RIGHT) > 0 }]),
)

const heatOf = (status: OrgStatus): OrgHeat => (status === 'running' || status === 'starting' ? 2 : status === 'waiting' ? 1 : 0)

type Cell = { strokes: number; heat: OrgHeat }

/** The connector cells, by row then column. */
class Grid {
  readonly rows = new Map<number, Map<number, Cell>>()

  add(x: number, y: number, strokes: number, heat: OrgHeat) {
    let row = this.rows.get(y)
    if (!row) this.rows.set(y, (row = new Map()))
    const cell = row.get(x)
    if (cell) {
      cell.strokes |= strokes
      if (heat > cell.heat) cell.heat = heat
    } else row.set(x, { strokes, heat })
  }

  /**
   * One parent to one child: down from under the parent's centre (`px`, `top`)
   * to the bus row `bus`, along it to the child's centre `kx`, and down into
   * the child's top border, the row under the bus.
   */
  edge(px: number, top: number, kx: number, bus: number, heat: OrgHeat) {
    for (let y = top; y < bus; y++) this.add(px, y, UP | DOWN, heat)
    if (kx === px) {
      this.add(px, bus, UP | DOWN, heat)
      return
    }
    const step = kx > px ? 1 : -1
    this.add(px, bus, UP | (step > 0 ? RIGHT : LEFT), heat)
    for (let x = px + step; x !== kx; x += step) this.add(x, bus, LEFT | RIGHT, heat)
    this.add(kx, bus, DOWN | (step > 0 ? LEFT : RIGHT), heat)
  }

  /** The cells as runs of one colour: across where they touch in a row, a lone cell's column merged downwards. */
  segments(): OrgSegment[] {
    const across: OrgSegment[] = []
    const singles: OrgSegment[] = []
    const keep = (run: OrgSegment) => (run.glyphs.length === 1 ? singles : across).push(run)
    for (const y of [...this.rows.keys()].sort((a, b) => a - b)) {
      let run: OrgSegment | null = null
      for (const [x, cell] of [...this.rows.get(y)!.entries()].sort((a, b) => a[0] - b[0])) {
        const glyph = GLYPHS[cell.strokes] ?? '┼'
        if (run && x === run.x + run.glyphs.length && cell.heat === run.heat) {
          run.glyphs += glyph
          continue
        }
        if (run) keep(run)
        run = { x, y, glyphs: glyph, down: false, heat: cell.heat }
      }
      if (run) keep(run)
    }
    singles.sort((a, b) => a.x - b.x || a.y - b.y)
    const down: OrgSegment[] = []
    for (const one of singles) {
      const last = down[down.length - 1]
      if (last && last.x === one.x && last.heat === one.heat && last.y + last.glyphs.length === one.y) {
        last.glyphs += one.glyphs
        last.down = true
      } else down.push({ ...one })
    }
    return [...across, ...down]
  }
}

/**
 * The chart for these agents in a region `columns` wide: card positions and
 * connector segments, in cells, the chart's own top-left at (0, 0).
 *
 * `columns` is the wrapping budget; 0 or less wraps nothing.
 */
export function orgLayoutOf(agents: readonly OrgAgent[], columns: number): OrgLayout {
  const tree = treeOf(orgAgentsOf(agents))
  const budget = columns > 0 ? columns : Number.POSITIVE_INFINITY
  const boxes = measureAll(tree, budget)
  const cards: OrgCard[] = []
  const grid = new Grid()

  const place = (a: OrgAgent, left: number, top: number, depth: number) => {
    const m = boxes.get(a.id)!
    const cx = left + m.cx
    cards.push({ agent: a, x: cx - HALF, y: top, depth })
    for (const row of m.rows) {
      let x = cx + row.start
      for (const k of row.kids) {
        const km = boxes.get(k.id)!
        grid.edge(cx, top + CARD_H, x + km.cx, top + row.top - 1, heatOf(k.status))
        place(k, x, top + row.top, depth + 1)
        x += km.w + GAP_X
      }
    }
  }

  let left = 0
  let height = 0
  for (const r of tree.roots) {
    const m = boxes.get(r.id)!
    place(r, left, 0, 0)
    left += m.w + ROOT_GAP
    height = Math.max(height, m.h)
  }
  const first = cards[0]
  return {
    width: tree.roots.length > 0 ? left - ROOT_GAP : 0,
    height,
    cards,
    segments: grid.segments(),
    hidden: tree.hidden,
    focus: first ? first.x + HALF : 0,
  }
}

/** The size a laid out chart asks of its region (orgSizeOf), `more` agents left out before it was laid out. */
export function orgSizeOfLayout(layout: OrgLayout, columns: number, more = 0): { columns: number; rows: number } {
  const across = columns > 0 ? columns : Math.max(1, layout.width)
  const hasNote = layout.hidden + more > 0 || layout.width > across
  return { columns: across, rows: Math.max(1, layout.height + (hasNote ? 1 : 0)) }
}

/**
 * The size the chart needs, to size its Client with: all of `columns` (the
 * chart centres itself in them, and pans when it is wider), and the rows its
 * cards take, one more for the line under them when it has one ("+3 more",
 * how to pan). The deck's views cap the rows at MAX_ROWS; the chart pans
 * down to the rest.
 */
export function orgSizeOf(agents: readonly OrgAgent[], columns: number): { columns: number; rows: number } {
  return orgSizeOfLayout(orgLayoutOf(agents, columns), columns)
}

/** One line of at most PROP_TEXT characters: what the props keep of a string. */
function clip(text: string): string {
  const line = oneLine(text)
  const chars = Array.from(line)
  return chars.length <= PROP_TEXT ? line : chars.slice(0, PROP_TEXT).join('')
}

/**
 * The Client's props for these agents in a region `columns` wide (the deck's
 * views hand them over, and give the Client `rows` as its height):
 *
 * - the agents the chart draws, the first MAX_AGENTS breadth first, the rest
 *   counted in `more`; each string one line of PROP_TEXT at most, so the
 *   props stay small however many agents run or however much they say;
 * - the rows the chart takes (orgSizeOf, the note's row counted), MAX_ROWS at most;
 * - the columns it was laid out in, which the chart lays out in too, so the
 *   rows it draws are the rows it was given.
 */
export function orgPropsOf(agents: readonly OrgAgent[], selected: string | null, columns: number): Required<OrgProps> {
  const all = orgAgentsOf(agents)
  const tree = treeOf(all)
  const kept = new Set(tree.roots.map(r => r.id))
  for (const list of tree.kids.values()) for (const k of list) kept.add(k.id)
  const shown = all
    .filter(a => kept.has(a.id))
    .map(a => ({ ...a, label: clip(a.label), type: clip(a.type), model: clip(a.model), tokens: clip(a.tokens), now: clip(a.now) }))
  const across = columns > 0 ? Math.floor(columns) : 0
  const rows = Math.min(MAX_ROWS, orgSizeOfLayout(orgLayoutOf(shown, across), across, tree.hidden).rows)
  return { agents: shown, selected, rows, columns: across, more: tree.hidden }
}

// --------------------------------------------------------------- the view

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))

/**
 * Where the chart sits in a region `columns` by `rows`, panned by `pan`
 * from where it starts:
 *
 * - centred across when it fits;
 * - wider than the region, the Orchestrator centred, no room left past either edge;
 * - from its top row.
 *
 * An axis the chart fits on does not pan. The pan comes back clamped, so a
 * drag past an edge stops there. `more`: agents left out before the layout,
 * counted in the note's "+N more" with the layout's own.
 */
export function orgViewOf(layout: OrgLayout, columns: number, rows: number, pan: { x: number; y: number } = { x: 0, y: 0 }, more = 0): OrgView {
  const hidden = layout.hidden + Math.max(0, more)
  const isWide = layout.width > columns
  const hasNote = hidden > 0 || isWide || layout.height > rows
  const chartRows = Math.max(0, rows - (hasNote ? 1 : 0))
  const isTall = layout.height > chartRows

  let x = Math.floor((columns - layout.width) / 2)
  let panX = 0
  if (isWide) {
    const start = clamp(Math.floor(columns / 2) - layout.focus, columns - layout.width, 0)
    x = clamp(start + Math.round(pan.x || 0), columns - layout.width, 0)
    panX = x - start
  }
  let y = 0
  let panY = 0
  if (isTall) {
    y = clamp(Math.round(pan.y || 0), chartRows - layout.height, 0)
    panY = y
  }

  const notes: string[] = []
  if (hidden > 0) notes.push(`+${hidden} more`)
  if (isWide || isTall) notes.push('drag or arrow keys to pan, Home centres')
  return { x, y, columns, rows: chartRows, panX, panY, note: notes.join(' · ') }
}

/** The card under a region cell, its agent's id, or null: a click's hit-test. */
export function orgCardAt(layout: OrgLayout, view: OrgView, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= view.columns || y >= view.rows) return null
  const cx = x - view.x
  const cy = y - view.y
  for (const card of layout.cards) {
    if (cx >= card.x && cx < card.x + CARD_W && cy >= card.y && cy < card.y + CARD_H) return card.agent.id
  }
  return null
}

/** The cards any cell of which shows in the view. */
export function orgCardsIn(layout: OrgLayout, view: OrgView): OrgCard[] {
  return layout.cards.filter(card => {
    const x = view.x + card.x
    const y = view.y + card.y
    return x + CARD_W > 0 && x < view.columns && y + CARD_H > 0 && y < view.rows
  })
}

/**
 * The part of a segment that shows in the view, in region cells (its glyphs
 * across, or down one a row), or null when none does.
 */
export function orgSegmentIn(segment: OrgSegment, view: OrgView): { x: number; y: number; glyphs: string; down: boolean } | null {
  const x = view.x + segment.x
  const y = view.y + segment.y
  const length = segment.glyphs.length
  if (!segment.down) {
    if (y < 0 || y >= view.rows) return null
    const from = Math.max(0, -x)
    const to = Math.min(length, view.columns - x)
    return to > from ? { x: x + from, y, glyphs: segment.glyphs.slice(from, to), down: false } : null
  }
  if (x < 0 || x >= view.columns) return null
  const from = Math.max(0, -y)
  const to = Math.min(length, view.rows - y)
  return to > from ? { x, y: y + from, glyphs: segment.glyphs.slice(from, to), down: true } : null
}

/**
 * A run of connector glyphs across, cut into pieces each drawn from its own
 * cell (`at`, from the run's first): every stretch of straight `─` one
 * piece, every other glyph (a corner, a tee, a crossing) one of its own.
 *
 * A surface whose box-drawing glyphs are wider than its cells (the
 * desktop's are about 1.17 cells) would draw a whole run longer than its
 * cells, its junctions off the cards' centres; drawn so, each junction sits
 * on its cell, and each stretch, clipped to its cells, ends where it should.
 */
export function orgPiecesOf(glyphs: string): { at: number; glyphs: string }[] {
  const pieces: { at: number; glyphs: string }[] = []
  Array.from(glyphs).forEach((glyph, at) => {
    const last = pieces[pieces.length - 1]
    if (glyph === '─' && last && last.glyphs.startsWith('─') && last.at + last.glyphs.length === at) last.glyphs += glyph
    else pieces.push({ at, glyphs: glyph })
  })
  return pieces
}

// -------------------------------------------------------------- the cards

const STATUS_WORD: Record<OrgStatus, string> = {
  starting: 'Starting',
  running: 'Running',
  waiting: 'Waiting',
  done: 'Done',
  failed: 'Failed',
  idle: 'Idle',
}

/** Control characters and runs of white space, each run one space on a card. */
const BREAKS = /[\u0000-\u001f\u007f-\u009f\s]+/g

/** One line: control characters and white space as single spaces, trimmed. */
const oneLine = (text: string) => text.replace(BREAKS, ' ').trim()

/** At most `max` characters, the last an ellipsis when it was cut. */
function cut(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
}

/**
 * A card's four lines, each cut to fit inside its border: the name (after
 * the status dot and a space), the type, model · tokens, and the now line
 * (its status when it has none).
 */
export function orgCardLinesOf(agent: OrgAgent): { name: string; type: string; meta: string; now: string } {
  return {
    name: cut(oneLine(agent.label) || agent.id, CARD_TEXT - 2),
    type: cut(oneLine(agent.type), CARD_TEXT),
    meta: cut([oneLine(agent.model) || '—', oneLine(agent.tokens)].filter(Boolean).join(' · '), CARD_TEXT),
    now: cut(oneLine(agent.now) || STATUS_WORD[agent.status], CARD_TEXT),
  }
}
