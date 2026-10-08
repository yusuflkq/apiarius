/**
 * The delegation map on the desktop's Agents tab, as two pure SVG views.
 *
 * - `treeSvg` draws a top-down tidy tree: You → Orchestrator → the agents it
 *   delegated to → their children, one plate per node. A wide fan-out wraps
 *   into rows under its parent, joined by a spine on the left, so nothing
 *   overlaps. The latest prompt labels the You → Orchestrator edge, and the
 *   selected agent's plate and its path up to You are copper.
 * - `wireSvg` draws a sequence diagram: one lane per participant in
 *   hierarchy order, one arrow per message, oldest at the top. A solid line
 *   with a filled head is an ask or a task, a thinner line with an outlined
 *   head is a result, and a dashed line is a message between agents.
 *
 * Both lay out on a ~900-wide logical canvas that `svgOpen` declares much
 * wider, so the desktop scales them to the pane (see `charts.ts`). They read
 * no clock and draw no motion: the same input gives the identical string, so
 * an unchanged map never reloads. Text widths are estimated a little wide, so
 * a long line ends in an ellipsis inside its plate. All text is escaped, and
 * every output stays under the Svg element's 131,072 characters.
 */

import { svgOpen } from '../charts'
import { STATUS_COLOR, T } from './theme'

export type MapStatus = 'running' | 'waiting' | 'done' | 'failed' | 'idle'

/**
 * One participant. `elapsed` and `now` arrive formatted ("4m", "Edit
 * src/auth.ts"), and `added` and `removed` count the lines the node changed.
 * A node whose `parent` is missing or unknown hangs under the Orchestrator,
 * whose own parent is always You.
 */
export type MapNode = {
  id: string
  name: string
  kind: 'you' | 'orchestrator' | 'agent' | 'peer'
  status: MapStatus
  parent?: string
  elapsed: string
  now: string
  added: number
  removed: number
}

/** One hand-off, listed oldest first. `at` arrives formatted ("14:05"). */
export type MapMessage = {
  id: string
  at: string
  from: string
  to: string
  tag: 'ask' | 'task' | 'result' | 'msg'
  text: string
}

const HINT = 'Agents appear here as the Orchestrator delegates work'
const NO_MESSAGES = 'No messages yet'

/** Past this many characters a drawing sheds detail, well inside the element's 131,072. */
const BUDGET = 120_000
const MEMO_SIZE = 8
/** The most characters of a full text a `<title>` holds. */
const TITLE_MAX = 400

/** The logical canvas: as wide as a pane, so 13px text reads at about 13px. */
const CANVAS = 900
const SIDE = 20

// Tree: plate size and the room around it.
const PW = 200
const PH = 50
const PAD = 10
/** Between sibling subtrees. */
const GAP = 16
/** Left of wrapped rows, where the spine joining them runs. */
const SPINE = 12
/** Parent to bus, and bus to child. */
const DROP = 16
/** A row's lowest plate to the next row's bus. */
const ROW_GAP = 14
const PER_ROW = 4
const YOU_GAP = 40
const TOP = 20
const BOTTOM = 20
/** Past this many agents the tree draws the first ones depth-first and counts the rest. */
const MOST_AGENTS = 80

// Wire: lanes and rows.
const TIME_X = 18
const LANES_X0 = 66
const LANES_X1 = CANVAS - SIDE
const PITCH_MAX = 210
const HEAD_TOP = 12
const HEAD_H = 28
const ROW_H = 34
const ARROW = 8
const MAX_LANES = 7
const MAX_MESSAGES = 14
/** Which agents fold into the overflow lane first; oldest first within each. */
const FOLD_ORDER: readonly MapStatus[] = ['done', 'idle', 'failed', 'waiting', 'running']

const KINDS: readonly MapNode['kind'][] = ['you', 'orchestrator', 'agent', 'peer']
const STATUSES: readonly MapStatus[] = ['running', 'waiting', 'done', 'failed', 'idle']
const TAGS: readonly MapMessage['tag'][] = ['ask', 'task', 'result', 'msg']

/** Line weight, dash and whether the head is outlined, per tag. */
const TAG_STYLE: Record<MapMessage['tag'], { width: number; dash: string; isOpen: boolean }> = {
  ask: { width: 1.5, dash: '', isOpen: false },
  task: { width: 1.5, dash: '', isOpen: false },
  result: { width: 1, dash: '', isOpen: true },
  msg: { width: 1.25, dash: '5 4', isOpen: false },
}

const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function esc(text: string): string {
  return text.replace(/[&<>"']/g, char => ENTITY[char] ?? char)
}

const LABEL_FONT = esc(T.fontLabel)
const MONO_FONT = esc(T.fontMono)

function str(value: unknown): string {
  if (typeof value === 'string') return value
  return value === undefined || value === null ? '' : String(value)
}

/** Drops UTF-16 halves without their pair, which XML may not hold. */
function whole(text: string): string {
  return text.replace(/[\ud800-\udfff]/g, (unit: string, at: number, all: string) => {
    if (unit.charCodeAt(0) < 0xdc00) {
      const next = all.charCodeAt(at + 1)
      return next >= 0xdc00 && next <= 0xdfff ? unit : ''
    }
    const prev = all.charCodeAt(at - 1)
    return prev >= 0xd800 && prev <= 0xdbff ? unit : ''
  })
}

/** Text for one row: control characters, line breaks and runs of space become one space. */
function line(value: unknown, most = 600): string {
  return whole(str(value).slice(0, most * 4))
    .replace(/[\u0000-\u001f\u007f-\u009f\ufffe\uffff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Text for a tooltip: line breaks kept, blank runs squeezed, at most `most` characters. */
function block(value: unknown, most: number): string {
  const text = whole(str(value).slice(0, most * 4))
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ufffe\uffff]/g, ' ')
    .split('\n')
    .map(row => row.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cap(text, most)
}

function cap(text: string, most: number): string {
  const chars = Array.from(text)
  return chars.length <= most ? text : `${chars.slice(0, most - 1).join('').trimEnd()}…`
}

/** The first line that says something, without markdown's heading, list and emphasis marks. */
function headline(text: string): string {
  for (const row of text.split('\n')) {
    if (/^\s*(```|~~~|-{3,}\s*$)/.test(row)) continue
    const bare = line(row.replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+[.)]\s+)/, '').replace(/\*\*|__|`/g, ''))
    if (bare !== '') return bare
  }
  return ''
}

type Face = 'label' | 'mono'

/**
 * Advances of printable ASCII (space to tilde) in hundredths of an em: the
 * wider of Bahnschrift and Segoe UI at weight 500, as a browser measures them.
 */
const ASCII_EM = [
  27, 30, 44, 62, 58, 84, 72, 26, 34, 34, 43, 69, 24, 48, 24, 41, 56, 40, 56, 56, 58, 56, 56, 54, 56, 56, 24, 24, 69, 69, 69, 44,
  95, 67, 65, 62, 72, 60, 56, 70, 74, 29, 51, 64, 57, 92, 77, 76, 62, 76, 65, 62, 55, 70, 64, 97, 62, 58, 59, 33, 40, 33, 69, 44,
  29, 53, 60, 50, 60, 54, 34, 60, 58, 26, 27, 53, 29, 89, 58, 60, 60, 60, 43, 52, 36, 58, 51, 77, 52, 51, 49, 36, 28, 36, 69,
]

/** Room a character takes, in em. Mono is Cascadia Mono's 0.59 rounded up. */
function emOf(char: string, face: Face): number {
  const cp = char.codePointAt(0) ?? 0
  if (cp >= 0x20 && cp < 0x7f) return face === 'mono' ? 0.6 : (ASCII_EM[cp - 0x20] ?? 60) / 100
  if (cp < 0x20 || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
  if (cp >= 0x1f000) return 1.4
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  ) {
    return 1.05
  }
  if (face === 'mono') return 0.6
  if (cp === 0x2026) return 0.81
  if (cp === 0x2212) return 0.69
  if (cp >= 0x2190 && cp <= 0x2bff) return 1
  return 0.65
}

function widthOf(text: string, size: number, face: Face = 'label'): number {
  let em = 0
  for (const char of text) em += emOf(char, face)
  return em * size
}

type Fit = { text: string; isCut: boolean }

/** `text` as it fits in `room` pixels at `size`, ending in an ellipsis when cut. */
function fit(text: string, size: number, room: number, face: Face = 'label'): Fit {
  if (widthOf(text, size, face) <= room) return { text, isCut: false }
  const ellipsis = emOf('…', face) * size
  let used = 0
  let kept = ''
  for (const char of text) {
    const width = emOf(char, face) * size
    if (used + width + ellipsis > room) break
    used += width
    kept += char
  }
  kept = kept.trimEnd()
  if (kept === '') return { text: ellipsis <= room ? '…' : '', isCut: true }
  return { text: `${kept}…`, isCut: true }
}

/** A coordinate to one decimal, without a trailing ".0" or a "-0". */
function f(n: number): string {
  const r = Math.round(n * 10) / 10
  return Object.is(r, -0) ? '0' : String(r)
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** A line count for a plate: exact under 10,000, then thousands. */
function lines(n: number): string {
  if (n < 10_000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

const treeMemo = new Map<string, string>()
const wireMemo = new Map<string, string>()

function recall(memo: Map<string, string>, key: string): string | undefined {
  const known = memo.get(key)
  if (known !== undefined) {
    memo.delete(key)
    memo.set(key, known)
  }
  return known
}

function remember(memo: Map<string, string>, key: string, svg: string): string {
  memo.set(key, svg)
  while (memo.size > MEMO_SIZE) memo.delete(memo.keys().next().value as string)
  return svg
}

/** A node with every field present, typed and on one line, so a key built from it is stable. */
function nodeOf(raw: MapNode): MapNode {
  const kind = KINDS.includes(raw?.kind) ? raw.kind : 'agent'
  const fallback = kind === 'you' ? 'You' : kind === 'orchestrator' ? 'Orchestrator' : 'Agent'
  return {
    id: str(raw?.id),
    name: line(raw?.name, 200) || fallback,
    kind,
    status: STATUSES.includes(raw?.status) ? raw.status : 'idle',
    parent: raw?.parent === undefined || raw?.parent === null ? undefined : str(raw.parent),
    elapsed: line(raw?.elapsed, 24),
    now: line(raw?.now, 300),
    added: count(raw?.added),
    removed: count(raw?.removed),
  }
}

function stub(id: string, name: string, kind: 'you' | 'orchestrator'): MapNode {
  return { id, name, kind, status: 'idle', elapsed: '', now: '', added: 0, removed: 0 }
}

type Hierarchy = {
  you: MapNode
  orch: MapNode
  /** Every other node, in the order given: oldest first. */
  agents: MapNode[]
  /** Every other node depth-first under the Orchestrator, children in the order given. */
  order: MapNode[]
  byId: Map<string, MapNode>
  parentOf: Map<string, string>
  kidsOf: Map<string, string[]>
}

/**
 * Who hangs under whom. The first `you` node is You and the first
 * `orchestrator` the Orchestrator (stand-ins are drawn when either is
 * missing). Every other node hangs under its parent when that is another
 * known agent, else under the Orchestrator; a loop of parents is cut there.
 */
function hierarchyOf(nodes: readonly MapNode[]): Hierarchy {
  const byId = new Map<string, MapNode>()
  for (const node of nodes) if (node.id !== '' && !byId.has(node.id)) byId.set(node.id, node)
  const all = [...byId.values()]
  const you = all.find(node => node.kind === 'you') ?? stub('\u0000you', 'You', 'you')
  const orch = all.find(node => node.kind === 'orchestrator' && node.id !== you.id) ?? stub('\u0000orchestrator', 'Orchestrator', 'orchestrator')
  byId.set(you.id, you)
  byId.set(orch.id, orch)
  const agents = all.filter(node => node.id !== you.id && node.id !== orch.id)

  const parentOf = new Map<string, string>()
  for (const node of agents) {
    const parent = node.parent
    const isKnown = parent !== undefined && parent !== node.id && parent !== you.id && byId.has(parent)
    parentOf.set(node.id, isKnown ? parent : orch.id)
  }
  for (const node of agents) {
    const seen = new Set<string>()
    for (let at = node.id; at !== orch.id; at = parentOf.get(at) ?? orch.id) {
      if (seen.has(at)) {
        parentOf.set(node.id, orch.id)
        break
      }
      seen.add(at)
    }
  }

  const kidsOf = new Map<string, string[]>()
  for (const node of agents) {
    const parent = parentOf.get(node.id) ?? orch.id
    const kids = kidsOf.get(parent)
    if (kids) kids.push(node.id)
    else kidsOf.set(parent, [node.id])
  }

  const order: MapNode[] = []
  const stack = [...(kidsOf.get(orch.id) ?? [])].reverse()
  while (stack.length > 0) {
    const id = stack.pop() as string
    const node = byId.get(id)
    if (!node) continue
    order.push(node)
    const kids = kidsOf.get(id) ?? []
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as string)
  }

  return { you, orch, agents, order, byId, parentOf, kidsOf }
}

/** A laid-out subtree, relative to its own top-left corner. */
type Box = {
  id: string
  w: number
  h: number
  /** The centre of this node's plate. */
  rootX: number
  kids: Slot[]
  /** Each row's bus line and top edge. */
  rows: { bus: number; top: number }[]
  isWrapped: boolean
}

type Slot = { box: Box; dx: number; dy: number; row: number }

/**
 * Lays out the subtree under `root` in at most `room` wide. Children sit in
 * one centred row when they fit; otherwise they wrap into rows of up to
 * four, left-aligned behind a spine. Bounding boxes never overlap.
 */
function layout(root: string, room: number, kidsOf: (id: string) => readonly string[]): Box {
  const memo = new Map<string, Box>()

  const oneRow = (id: string, boxes: readonly Box[]): Box => {
    const top = PH + 2 * DROP
    const kids: Slot[] = []
    let x = 0
    let h = 0
    for (const box of boxes) {
      kids.push({ box, dx: x, dy: top, row: 0 })
      x += box.w + GAP
      h = Math.max(h, box.h)
    }
    return { id, w: Math.max(PW, x - GAP), h: top + h, rootX: centreOf(kids), kids, rows: [{ bus: PH + DROP, top }], isWrapped: false }
  }

  const manyRows = (id: string, rows: readonly (readonly Box[])[]): Box => {
    const kids: Slot[] = []
    const out: Box['rows'] = []
    let bus = PH + DROP
    let w = 0
    let bottom = 0
    rows.forEach((row, r) => {
      const top = bus + DROP
      let x = SPINE
      let h = 0
      for (const box of row) {
        kids.push({ box, dx: x, dy: top, row: r })
        x += box.w + GAP
        h = Math.max(h, box.h)
      }
      w = Math.max(w, x - GAP)
      out.push({ bus, top })
      bottom = top + h
      bus = bottom + ROW_GAP
    })
    return { id, w, h: bottom, rootX: centreOf(kids.filter(kid => kid.row === 0)), kids, rows: out, isWrapped: true }
  }

  const lay = (id: string, width: number): Box => {
    const key = `${id}\u0000${width}`
    const known = memo.get(key)
    if (known) return known
    const kids = kidsOf(id)
    let box: Box | undefined
    if (kids.length === 0) {
      box = { id, w: PW, h: PH, rootX: PW / 2, kids: [], rows: [], isWrapped: false }
    } else if (kids.length <= PER_ROW) {
      const boxes = kids.map(kid => lay(kid, width))
      if (rowWidth(boxes) <= width) box = oneRow(id, boxes)
    }
    if (!box) {
      const inner = width - SPINE
      const rows = pack(kids.map(kid => lay(kid, inner)), inner)
      box = rows.length === 1 ? oneRow(id, rows[0] ?? []) : manyRows(id, rows)
    }
    memo.set(key, box)
    return box
  }

  return lay(root, room)
}

function rowWidth(boxes: readonly Box[]): number {
  return boxes.reduce((sum, box) => sum + box.w, 0) + GAP * Math.max(0, boxes.length - 1)
}

/** Greedy rows of at most `PER_ROW` boxes and `room` wide; a box wider than `room` gets a row to itself. */
function pack(boxes: readonly Box[], room: number): Box[][] {
  const rows: Box[][] = []
  let row: Box[] = []
  let w = 0
  for (const box of boxes) {
    const next = row.length === 0 ? box.w : w + GAP + box.w
    if (row.length > 0 && (row.length >= PER_ROW || next > room)) {
      rows.push(row)
      row = [box]
      w = box.w
    } else {
      row.push(box)
      w = next
    }
  }
  if (row.length > 0) rows.push(row)
  return rows
}

/** Midway between the first and last child's plate: a parent sits centred over its row. */
function centreOf(slots: readonly Slot[]): number {
  const first = slots[0]
  const last = slots[slots.length - 1]
  if (!first || !last) return PW / 2
  return (first.dx + first.box.rootX + last.dx + last.box.rootX) / 2
}

type Spot = { x: number; y: number }

type Placement = {
  /** Each plate's top-left corner. */
  spots: Map<string, Spot>
  /** The connector segments, each `M…` once. */
  segments: string[]
  /** Each node's edge from its parent's plate to its own, as path data. */
  edges: Map<string, string>
}

/** Puts `box` at (`ax`, `ay`) and records plates and elbows for it and everything under it. */
function place(box: Box, ax: number, ay: number, into: Placement): void {
  const px = ax + box.rootX
  into.spots.set(box.id, { x: px - PW / 2, y: ay })
  const first = box.rows[0]
  if (!first || box.kids.length === 0) return
  const bottom = ay + PH
  const bus0 = ay + first.bus
  const spine = ax + SPINE / 2
  into.segments.push(`M${f(px)} ${f(bottom)}V${f(bus0)}`)

  box.rows.forEach((row, r) => {
    const slots = box.kids.filter(kid => kid.row === r)
    const centres = slots.map(slot => ax + slot.dx + slot.box.rootX)
    const bus = ay + row.bus
    let lo = Math.min(...centres)
    let hi = Math.max(...centres)
    if (r === 0) {
      lo = Math.min(lo, px)
      hi = Math.max(hi, px)
    }
    if (box.isWrapped) lo = Math.min(lo, spine)
    if (hi > lo) into.segments.push(`M${f(lo)} ${f(bus)}H${f(hi)}`)
    slots.forEach((slot, i) => {
      const cx = centres[i] ?? px
      const top = ay + slot.dy
      into.segments.push(`M${f(cx)} ${f(bus)}V${f(top)}`)
      const across = r === 0 ? (cx === px ? '' : `H${f(cx)}`) : `H${f(spine)}V${f(bus)}H${f(cx)}`
      into.edges.set(slot.box.id, `M${f(px)} ${f(bottom)}V${f(bus0)}${across}V${f(top)}`)
      place(slot.box, ax + slot.dx, top, into)
    })
  })

  const last = box.rows[box.rows.length - 1]
  if (box.isWrapped && last) into.segments.push(`M${f(spine)} ${f(bus0)}V${f(ay + last.bus)}`)
}

/** A node's plate: status square, name, elapsed time, what it is doing now, and its line counts. */
function plateSvg(node: MapNode, spot: Spot, isSelected: boolean, withTitle: boolean): string {
  const { x, y } = spot
  const right = x + PW - PAD
  const elapsed = fit(node.elapsed, 11, 72, 'mono')
  const elapsedRoom = elapsed.text === '' ? 0 : widthOf(elapsed.text, 11, 'mono') + 8
  const name = fit(node.name, 13, PW - 24 - PAD - elapsedRoom)
  const added = node.added > 0 ? `+${lines(node.added)}` : ''
  const removed = node.removed > 0 ? `−${lines(node.removed)}` : ''
  const diff = [added, removed].filter(Boolean).join(' ')
  const diffRoom = diff === '' ? 0 : widthOf(diff, 11, 'mono') + 10
  const now = fit(node.now, 11, PW - 2 * PAD - diffRoom)
  const title = withTitle && (name.isCut || now.isCut) ? `<title>${esc(cap([node.name, node.now].filter(Boolean).join('\n'), 200))}</title>` : ''
  const frame = isSelected ? `fill="${T.selected}" stroke="${T.copper}" stroke-width="1.5"` : `fill="${T.panel}" stroke="${T.line}" stroke-width="1"`
  return [
    `<g data-id="${esc(node.id)}">`,
    title,
    `<rect class="plate" x="${f(x)}" y="${f(y)}" width="${PW}" height="${PH}" rx="3" ${frame}/>`,
    `<rect x="${f(x + PAD)}" y="${f(y + 13)}" width="8" height="8" fill="${STATUS_COLOR[node.status]}"/>`,
    `<text x="${f(x + 24)}" y="${f(y + 21)}" font-size="13" font-weight="500" fill="${T.text1}">${esc(name.text)}</text>`,
    elapsed.text === '' ? '' : `<text x="${f(right)}" y="${f(y + 21)}" font-family="${MONO_FONT}" font-size="11" text-anchor="end" fill="${T.text3}">${esc(elapsed.text)}</text>`,
    now.text === '' ? '' : `<text x="${f(x + PAD)}" y="${f(y + 39)}" font-size="11" fill="${T.text2}">${esc(now.text)}</text>`,
    diff === ''
      ? ''
      : `<text x="${f(right)}" y="${f(y + 39)}" font-family="${MONO_FONT}" font-size="11" text-anchor="end">${added === '' ? '' : `<tspan fill="${T.ok}">${added}</tspan>`}${removed === '' ? '' : `<tspan fill="${T.err}">${added === '' ? '' : ' '}${removed}</tspan>`}</text>`,
    '</g>',
  ].join('')
}

function drawTree(h: Hierarchy, selected: string, prompt: string, opts: { withTitles: boolean; most: number }): string {
  const shown = h.order.slice(0, opts.most)
  const keep = new Set(shown.map(node => node.id))
  const hidden = h.order.length - shown.length
  const box = layout(h.orch.id, CANVAS - 2 * SIDE, id => (h.kidsOf.get(id) ?? []).filter(kid => keep.has(kid)))

  const width = Math.max(CANVAS, Math.ceil(box.w + 2 * SIDE))
  const ax = Math.round((width - box.w) / 2)
  const orchY = TOP + PH + YOU_GAP
  const into: Placement = { spots: new Map(), segments: [], edges: new Map() }
  place(box, ax, orchY, into)
  const ox = ax + box.rootX
  into.spots.set(h.you.id, { x: ox - PW / 2, y: TOP })
  const youEdge = `M${f(ox)} ${f(TOP + PH)}V${f(orchY)}`
  into.segments.unshift(youEdge)
  into.edges.set(h.orch.id, youEdge)

  let height = orchY + box.h + BOTTOM
  const after: string[] = []
  if (h.order.length === 0) {
    const y = orchY + PH + 28
    after.push(
      `<path d="M${f(ox)} ${f(orchY + PH)}V${f(y)}" fill="none" stroke="${T.line}" stroke-dasharray="3 3"/>`,
      `<rect x="${f(ox - 190)}" y="${f(y)}" width="380" height="40" rx="3" fill="none" stroke="${T.line}" stroke-dasharray="4 4"/>`,
      `<text x="${f(ox)}" y="${f(y + 24)}" font-size="12" text-anchor="middle" fill="${T.text3}">${esc(HINT)}</text>`,
    )
    height = y + 40 + BOTTOM
  }
  if (hidden > 0) {
    after.push(`<text x="${f(width / 2)}" y="${f(height + 2)}" font-size="11" text-anchor="middle" fill="${T.text3}">${esc(`+${hidden} more agents not shown`)}</text>`)
    height += 24
  }

  const path: string[] = []
  if (selected !== h.you.id && into.spots.has(selected)) {
    let at = selected
    for (let guard = 0; at !== '' && guard <= h.order.length + 1; guard++) {
      path.unshift(into.edges.get(at) ?? '')
      at = at === h.orch.id ? '' : (h.parentOf.get(at) ?? h.orch.id)
    }
  }

  const plates: string[] = []
  for (const node of [h.you, h.orch, ...shown]) {
    const spot = into.spots.get(node.id)
    if (spot) plates.push(plateSvg(node, spot, node.id === selected, opts.withTitles))
  }

  const label: string[] = []
  const said = line(prompt)
  if (said !== '') {
    const rightRoom = width - SIDE - (ox + 10)
    const leftRoom = ox - 10 - SIDE
    const isRight = rightRoom >= leftRoom || widthOf(said, 11) <= rightRoom
    const cut = fit(said, 11, isRight ? rightRoom : leftRoom)
    const x = isRight ? ox + 10 : ox - 10
    label.push(
      '<g>',
      cut.isCut && opts.withTitles ? `<title>${esc(prompt)}</title>` : '',
      `<text x="${f(x)}" y="${f(TOP + PH + YOU_GAP / 2 + 4)}" font-size="11"${isRight ? '' : ' text-anchor="end"'} fill="${T.text3}">${esc(cut.text)}</text>`,
      '</g>',
    )
  }

  height = Math.ceil(height)
  return [
    svgOpen(width, height, ` font-family="${LABEL_FONT}"`),
    `<rect width="${width}" height="${height}" fill="${T.bg}"/>`,
    `<path d="${into.segments.join('')}" fill="none" stroke="${T.lineStrong}" stroke-width="1" stroke-linecap="square"/>`,
    path.length > 0 ? `<path class="path" d="${path.join('')}" fill="none" stroke="${T.copper}" stroke-width="1.5" stroke-linecap="square"/>` : '',
    ...after,
    ...label,
    ...plates,
    '</svg>',
  ].join('')
}

/**
 * The delegation tree: You on top, the Orchestrator under it, then every
 * agent under the one that delegated to it, wrapping wide fan-outs into rows
 * of about four. `options.prompt` labels the You → Orchestrator edge, and
 * `options.selected` (a node id, or '' for none) gets a copper plate and a
 * copper path up to You.
 */
export function treeSvg(nodes: readonly MapNode[], options: { selected: string; prompt?: string }): string {
  const list = nodes.map(nodeOf)
  const selected = str(options?.selected)
  const prompt = block(options?.prompt, TITLE_MAX)
  const key = JSON.stringify([list, selected, prompt])
  const known = recall(treeMemo, key)
  if (known !== undefined) return known

  const h = hierarchyOf(list)
  let svg = drawTree(h, selected, prompt, { withTitles: true, most: MOST_AGENTS })
  if (svg.length > BUDGET) svg = drawTree(h, selected, prompt, { withTitles: false, most: MOST_AGENTS })
  for (let most = MOST_AGENTS; svg.length > BUDGET && most > 1; ) {
    most = Math.floor(most / 2)
    svg = drawTree(h, selected, prompt, { withTitles: false, most })
  }
  return remember(treeMemo, key, svg)
}

type Lane = { name: string; isFold: boolean; isSelected: boolean }

/**
 * One lane per participant in hierarchy order, at most `MAX_LANES`: past
 * that the oldest finished agents (then idle, failed, waiting and running
 * ones, never the selected) fold into one last "+N done" lane.
 */
function lanesOf(h: Hierarchy, selected: string): { lanes: Lane[]; laneOf: Map<string, number> } {
  const room = MAX_LANES - 2
  const folded = new Set<string>()
  if (h.order.length > room) {
    const need = h.order.length - (room - 1)
    for (const status of FOLD_ORDER) {
      for (const node of h.agents) {
        if (folded.size >= need) break
        if (node.status === status && node.id !== selected) folded.add(node.id)
      }
    }
  }

  const lanes: Lane[] = []
  const laneOf = new Map<string, number>()
  for (const node of [h.you, h.orch, ...h.order]) {
    if (folded.has(node.id)) continue
    laneOf.set(node.id, lanes.length)
    lanes.push({ name: node.name, isFold: false, isSelected: node.id === selected })
  }
  if (folded.size > 0) {
    const isDone = [...folded].every(id => h.byId.get(id)?.status === 'done')
    for (const id of folded) laneOf.set(id, lanes.length)
    lanes.push({ name: `+${folded.size} ${isDone ? 'done' : 'more'}`, isFold: true, isSelected: false })
  }
  return { lanes, laneOf }
}

function messageOf(raw: MapMessage): MapMessage {
  return {
    id: str(raw?.id),
    at: line(raw?.at, 12),
    from: str(raw?.from),
    to: str(raw?.to),
    tag: TAGS.includes(raw?.tag) ? raw.tag : 'msg',
    text: block(raw?.text, TITLE_MAX),
  }
}

/**
 * One message's arrow from lane `x1` to lane `x2` at `y`, its label above
 * and its full text as the tooltip. A message to its own lane loops out to
 * `loop.side` (1 right, -1 left), its label beside the loop in `loop.room`.
 */
function arrowSvg(message: MapMessage, x1: number, x2: number, y: number, isHot: boolean, loop: { side: number; room: number }, withTitle: boolean): string {
  const style = TAG_STYLE[message.tag]
  const color = isHot ? T.copper : T.text3
  const dash = style.dash === '' ? '' : ` stroke-dasharray="${style.dash}"`
  const head = style.isOpen ? `fill="${T.bg}" stroke="${color}" stroke-width="1"` : `fill="${color}"`
  const title = withTitle && message.text !== '' ? `<title>${esc(message.text)}</title>` : ''
  const ink = isHot ? T.text1 : T.text2
  const halo = `stroke="${T.bg}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"`

  if (x1 === x2) {
    const { side, room } = loop
    const out = x1 + side * 22
    const base = x1 + side * ARROW
    const label = fit(headline(message.text), 11, room - 30)
    return [
      '<g class="msg">',
      title,
      `<rect x="${f(side > 0 ? x1 : x1 - room)}" y="${f(y - 10)}" width="${f(room)}" height="22" fill="#000" fill-opacity="0"/>`,
      `<path d="M${f(x1)} ${f(y - 6)}H${f(out)}V${f(y + 5)}H${f(base)}" fill="none" stroke="${color}" stroke-width="${style.width}"${dash}/>`,
      `<path d="M${f(x1)} ${f(y + 5)}L${f(base)} ${f(y + 1)}V${f(y + 9)}Z" ${head}/>`,
      label.text === ''
        ? ''
        : `<text x="${f(out + side * 8)}" y="${f(y + 3)}" font-size="11"${side > 0 ? '' : ' text-anchor="end"'} fill="${ink}" ${halo}>${esc(label.text)}</text>`,
      '</g>',
    ].join('')
  }

  const dir = x2 > x1 ? 1 : -1
  const base = x2 - dir * ARROW
  const span = Math.abs(x2 - x1)
  const label = fit(headline(message.text), 11, span - 16)
  return [
    '<g class="msg">',
    title,
    `<rect x="${f(Math.min(x1, x2))}" y="${f(y - 17)}" width="${f(span)}" height="23" fill="#000" fill-opacity="0"/>`,
    `<path d="M${f(x1)} ${f(y)}H${f(base)}" fill="none" stroke="${color}" stroke-width="${style.width}"${dash}/>`,
    `<path d="M${f(x2)} ${f(y)}L${f(base)} ${f(y - 4)}V${f(y + 4)}Z" ${head}/>`,
    label.text === '' ? '' : `<text x="${f((x1 + x2) / 2)}" y="${f(y - 7)}" font-size="11" text-anchor="middle" fill="${ink}" ${halo}>${esc(label.text)}</text>`,
    '</g>',
  ].join('')
}

function drawWire(h: Hierarchy, lanes: readonly Lane[], laneOf: ReadonlyMap<string, number>, shown: readonly MapMessage[], earlier: number, selected: string, withTitles: boolean): string {
  const span = LANES_X1 - LANES_X0
  const pitch = Math.min(PITCH_MAX, span / lanes.length)
  const start = LANES_X0 + (span - pitch * lanes.length) / 2
  const xs = lanes.map((_, i) => start + pitch * (i + 0.5))
  /** The time column keeps to the left of the lanes, wherever they centre. */
  const timeX = start - (LANES_X0 - TIME_X)
  const headBottom = HEAD_TOP + HEAD_H
  const rowsTop = headBottom + (earlier > 0 ? 24 : 6)
  const hint = h.order.length === 0 ? HINT : shown.length === 0 ? NO_MESSAGES : ''
  const bodyBottom = rowsTop + shown.length * ROW_H
  const hintY = bodyBottom + 26
  const height = Math.ceil(hint === '' ? bodyBottom + 14 : hintY + 22)
  const halo = `stroke="${T.bg}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"`

  const lifelines: string[] = []
  const heads: string[] = []
  lanes.forEach((lane, i) => {
    const x = xs[i] ?? 0
    lifelines.push(
      lane.isSelected
        ? `<path class="life" d="M${f(x)} ${headBottom}V${height - 10}" stroke="${T.copper}" stroke-width="1.5"/>`
        : `<path class="life" d="M${f(x)} ${headBottom}V${height - 10}" stroke="${T.line}" stroke-width="1" stroke-dasharray="3 4"/>`,
    )
    const name = fit(lane.name, 13, pitch - 10)
    const ink = lane.isSelected ? T.copper : lane.isFold ? T.text3 : T.text1
    heads.push(
      '<g>',
      name.isCut && withTitles ? `<title>${esc(lane.name)}</title>` : '',
      `<text class="lane" x="${f(x)}" y="${HEAD_TOP + 16}" font-size="13" font-weight="500" text-anchor="middle" fill="${ink}">${esc(name.text)}</text>`,
      '</g>',
    )
  })

  const rows: string[] = []
  if (earlier > 0) {
    rows.push(`<text x="${f(timeX)}" y="${headBottom + 16}" font-size="10" fill="${T.text3}" ${halo}>${earlier} earlier message${earlier === 1 ? '' : 's'}</text>`)
  }
  shown.forEach((message, i) => {
    const y = rowsTop + i * ROW_H + 21
    const a = laneOf.get(message.from) ?? 0
    const b = laneOf.get(message.to) ?? 0
    const x1 = xs[a] ?? 0
    const x2 = xs[b] ?? 0
    const isHot = selected !== '' && (message.from === selected || message.to === selected)
    const isRepeat = i > 0 && shown[i - 1]?.at === message.at
    const at = fit(message.at, 10, LANES_X0 - TIME_X - 6, 'mono')
    if (at.text !== '') rows.push(`<text x="${f(timeX)}" y="${f(y + 3.5)}" font-family="${MONO_FONT}" font-size="10" fill="${isRepeat ? T.text4 : T.text3}">${esc(at.text)}</text>`)
    const right = (xs[a + 1] ?? CANVAS - 8) - x1 - 8
    const left = x1 - (xs[a - 1] ?? start) - 8
    const loop = right >= left ? { side: 1, room: right } : { side: -1, room: left }
    rows.push(arrowSvg(message, x1, x2, y, isHot, loop, withTitles))
  })
  if (hint !== '') {
    const mid = ((xs[0] ?? 0) + (xs[xs.length - 1] ?? 0)) / 2
    rows.push(`<text x="${f(mid)}" y="${hintY}" font-size="12" text-anchor="middle" fill="${T.text3}" ${halo}>${esc(hint)}</text>`)
  }

  return [
    svgOpen(CANVAS, height, ` font-family="${LABEL_FONT}"`),
    `<rect width="${CANVAS}" height="${height}" fill="${T.bg}"/>`,
    ...lifelines,
    ...heads,
    ...rows,
    '</svg>',
  ].join('')
}

/**
 * The wire: who handed what to whom, in order. One lane per participant
 * (You, the Orchestrator, then agents depth-first; at most seven, the oldest
 * finished agents folding into "+N done") and one arrow per message, the
 * newest fourteen with an "earlier messages" marker above them when more
 * came before. A message naming a node not in `nodes` is not drawn. The
 * selected node's lane and every arrow touching it are copper.
 */
export function wireSvg(nodes: readonly MapNode[], messages: readonly MapMessage[], options: { selected: string }): string {
  const list = nodes.map(nodeOf)
  const selected = str(options?.selected)
  const h = hierarchyOf(list)
  const known = messages.filter(message => h.byId.has(str(message?.from)) && h.byId.has(str(message?.to)))
  const earlier = Math.max(0, known.length - MAX_MESSAGES)
  const shown = known.slice(earlier).map(messageOf)
  const key = JSON.stringify([list, selected, earlier, shown])
  const remembered = recall(wireMemo, key)
  if (remembered !== undefined) return remembered

  const { lanes, laneOf } = lanesOf(h, selected)
  let svg = drawWire(h, lanes, laneOf, shown, earlier, selected, true)
  if (svg.length > BUDGET) svg = drawWire(h, lanes, laneOf, shown, earlier, selected, false)
  return remember(wireMemo, key, svg)
}
