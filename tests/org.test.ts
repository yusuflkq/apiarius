/**
 * The Org tab's chart: its pure layout (hooks/ui/dash/orgLayout.ts) and its
 * surface module (hooks/ui/dash/org.client.tsx).
 *
 * The kit mounts a Client only where the plugin's own hooks draw one (here,
 * the deck's Org tab), and an inline test plugin's hooks run from a folder of
 * their own, so its `module` cannot name this plugin's file. So the module is
 * driven here as a surface drives it: its function called with a surface of
 * the test's (elements, state, listeners, post), each input followed by the
 * redraw it asks for.
 */
import type { ClientKeyEvent, ClientPointerEvent, ClientSurface, JsonValue } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import Org from '../hooks/ui/dash/org.client'
import {
  CARD_H,
  CARD_TEXT,
  CARD_W,
  GAP_X,
  GAP_Y,
  GLYPH_STROKES,
  MAX_AGENTS,
  orgAgentsOf,
  orgCardAt,
  orgCardLinesOf,
  orgCardsIn,
  orgLayoutOf,
  orgSegmentIn,
  orgSizeOf,
  orgViewOf,
  type OrgAgent,
  type OrgCard,
  type OrgLayout,
  type OrgStatus,
} from '../hooks/ui/dash/orgLayout'

// ------------------------------------------------------------- fixtures

function agent(id: string, parent: string | null, status: OrgStatus = 'done', more: Partial<OrgAgent> = {}): OrgAgent {
  return { id, label: id, type: 'general-purpose', model: 'opus-5.5', tokens: '12k', status, now: `on ${id}`, parent, ...more }
}

const MAIN = agent('main', null, 'running', { label: 'Orchestrator', type: 'main loop' })

/** `n` agents under `parent`: k1, k2, ... */
function team(n: number, parent = 'main', prefix = 'k', status: OrgStatus = 'done'): OrgAgent[] {
  return Array.from({ length: n }, (_, i) => agent(`${prefix}${i + 1}`, parent, status))
}

/** Two agents under the Orchestrator, three and two under them: 109 cells across in rows of two, wider than 68. */
const WIDE = [MAIN, agent('A', 'main'), agent('B', 'main'), ...team(3, 'A', 'A'), ...team(2, 'B', 'B')]

// -------------------------------------------------------------- helpers

const HALF = (CARD_W - 1) / 2
const card = (L: OrgLayout, id: string): OrgCard => {
  const found = L.cards.find(c => c.agent.id === id)
  expect(found, `a card for ${id}`).toBeDefined()
  return found!
}
const mid = (c: OrgCard) => c.x + HALF
const at = (L: OrgLayout, id: string) => ({ x: card(L, id).x, y: card(L, id).y })
const isInCard = (L: OrgLayout, x: number, y: number) => L.cards.some(c => x >= c.x && x < c.x + CARD_W && y >= c.y && y < c.y + CARD_H)

/** The connector glyph in each cell, by `x,y`, and any cell two segments draw. */
function wiresOf(L: OrgLayout): { grid: Map<string, string>; twice: string[] } {
  const grid = new Map<string, string>()
  const twice: string[] = []
  for (const s of L.segments) {
    Array.from(s.glyphs).forEach((glyph, i) => {
      const cell = s.down ? `${s.x},${s.y + i}` : `${s.x + i},${s.y}`
      if (grid.has(cell)) twice.push(cell)
      grid.set(cell, glyph)
    })
  }
  return { grid, twice }
}

/** One row of connectors as text, from column `from` to `to`, a space where none is. */
function wireRow(L: OrgLayout, y: number, from: number, to: number): string {
  const { grid } = wiresOf(L)
  let row = ''
  for (let x = from; x <= to; x++) row += grid.get(`${x},${y}`) ?? ' '
  return row
}

const STEPS = [
  { dx: 0, dy: -1, out: 'up', into: 'down' },
  { dx: 0, dy: 1, out: 'down', into: 'up' },
  { dx: -1, dy: 0, out: 'left', into: 'right' },
  { dx: 1, dy: 0, out: 'right', into: 'left' },
] as const

/** Every connector cell reached from (x, y) along the glyphs' strokes, each step one a glyph draws out and its neighbour draws in. */
function reach(grid: ReadonlyMap<string, string>, x: number, y: number): Set<string> {
  const seen = new Set<string>([`${x},${y}`])
  const queue = [[x, y] as const]
  for (let i = 0; i < queue.length; i++) {
    const [cx, cy] = queue[i]!
    const strokes = GLYPH_STROKES[grid.get(`${cx},${cy}`) ?? '']
    if (!strokes) continue
    for (const step of STEPS) {
      const next = `${cx + step.dx},${cy + step.dy}`
      const there = GLYPH_STROKES[grid.get(next) ?? '']
      if (!strokes[step.out] || !there || !there[step.into] || seen.has(next)) continue
      seen.add(next)
      queue.push([cx + step.dx, cy + step.dy])
    }
  }
  return seen
}

/**
 * What every chart keeps to: each card inside the chart, no two overlapping,
 * no connector in a card, and each parent's connectors joining it to its
 * children and nothing else, from the stem under its card along matching
 * strokes into the cell over each child's top centre. Faults are gathered
 * and checked once: a property test runs this over hundreds of charts.
 */
function expectSound(L: OrgLayout, what: string) {
  const { grid, twice } = wiresOf(L)
  const faults = twice.map(cell => `cell ${cell} drawn twice`)
  for (const c of L.cards) {
    if (c.x < 0 || c.y < 0 || c.x + CARD_W > L.width || c.y + CARD_H > L.height) faults.push(`${c.agent.id} outside the chart`)
  }
  for (let i = 0; i < L.cards.length; i++) {
    for (let j = i + 1; j < L.cards.length; j++) {
      const a = L.cards[i]!
      const b = L.cards[j]!
      const apart = a.x + CARD_W <= b.x || b.x + CARD_W <= a.x || a.y + CARD_H <= b.y || b.y + CARD_H <= a.y
      if (!apart) faults.push(`${a.agent.id} and ${b.agent.id} overlap`)
    }
  }
  for (const cell of grid.keys()) {
    const [x, y] = cell.split(',').map(Number) as [number, number]
    if (isInCard(L, x, y)) faults.push(`the connector at ${cell} is inside a card`)
  }
  const tops = new Map(L.cards.map(c => [`${mid(c)},${c.y - 1}`, c.agent.id]))
  for (const p of L.cards) {
    const kids = L.cards.filter(c => c.depth > 0 && c.agent.parent === p.agent.id).map(c => c.agent.id).sort()
    const stem = `${mid(p)},${p.y + CARD_H}`
    if (kids.length === 0) {
      if (grid.has(stem)) faults.push(`a stem under ${p.agent.id}, which has no children`)
      continue
    }
    if (!GLYPH_STROKES[grid.get(stem) ?? '']?.up) faults.push(`no stem under ${p.agent.id}`)
    const into = [...reach(grid, mid(p), p.y + CARD_H)]
      .filter(cell => tops.has(cell) && GLYPH_STROKES[grid.get(cell)!]!.down)
      .map(cell => tops.get(cell)!)
      .sort()
    if (into.join() !== kids.join()) faults.push(`${p.agent.id}'s connectors come down into ${into.join() || 'nothing'}, not its children ${kids.join()}`)
  }
  expect(faults, what).toEqual([])
}

/** A seeded tree of `size`: the Orchestrator first, each agent under the Orchestrator, an earlier agent, or (a few) none. */
function randomTeam(seed: number, size: number): OrgAgent[] {
  let s = seed >>> 0
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const statuses: OrgStatus[] = ['starting', 'running', 'waiting', 'done', 'failed', 'idle']
  const out = [MAIN]
  for (let i = 1; i < size; i++) {
    const r = rand()
    const parent = r < 0.05 ? null : r < 0.45 ? 'main' : out[Math.floor(rand() * out.length)]!.id
    out.push(agent(`a${i}`, parent, statuses[Math.floor(rand() * statuses.length)]!))
  }
  return out
}

// ------------------------------------------------- a surface of the test's

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] }

/** A tag as `h` calls one, with its props and the children among them: a plain node, nested arrays and nulls flattened away. */
const tag =
  (type: string) =>
  (props: Record<string, unknown>): Node => {
    const { children, ...rest } = props
    const flat = (value: unknown): (Node | string)[] =>
      Array.isArray(value) ? value.flatMap(flat) : value === null || value === undefined || value === false ? [] : [value as Node | string]
    return { type, props: rest, children: flat(children) }
  }
const ELEMENTS = { Box: tag('Box'), Text: tag('Text'), Button: tag('Button'), Input: tag('Input'), Select: tag('Select'), Link: tag('Link'), Code: tag('Code'), Markdown: tag('Markdown') }

type Props = { agents: OrgAgent[]; selected: string | null }
type Surface = Parameters<typeof Org>[1]

/**
 * One instance as a surface runs it: drawn for its props in a region of a
 * size; each pointer or key event handed to the listener the last drawing
 * set, then drawn again when it set state; new props or a resize draw again,
 * the state kept; what it posts, kept.
 */
function mount(first: Props, columns: number, rows: number) {
  let props = first
  let size = { columns, rows }
  let state: unknown
  let dirty = false
  let onPointer: ((event: ClientPointerEvent) => void) | undefined
  let onKey: ((event: ClientKeyEvent) => void) | undefined
  const posts: JsonValue[] = []
  const surface = {
    elements: ELEMENTS,
    get state() {
      return state
    },
    setState(next: unknown) {
      state = next
      dirty = true
    },
    get columns() {
      return size.columns
    },
    get rows() {
      return size.rows
    },
    every: () => () => {},
    onPointer(fn: (event: ClientPointerEvent) => void) {
      onPointer = fn
      return () => {}
    },
    onKey(fn: (event: ClientKeyEvent) => void) {
      onKey = fn
      return () => {}
    },
    post(data: JsonValue) {
      posts.push(data)
    },
  } as unknown as Surface
  const draw = () => {
    dirty = false
    return Org(props, surface) as unknown as Node
  }
  let tree = draw()
  const settle = () => {
    if (dirty) tree = draw()
  }
  return {
    posts,
    get tree() {
      return tree
    },
    pointer(event: ClientPointerEvent) {
      onPointer?.(event)
      settle()
    },
    key(event: ClientKeyEvent) {
      onKey?.(event)
      settle()
    },
    props(next: Props) {
      props = next
      tree = draw()
    },
    resize(across: number, down: number) {
      size = { columns: across, rows: down }
      tree = draw()
    },
  }
}

/** The node keyed `key`, depth first. */
function keyed(node: Node | string, key: string): Node | undefined {
  if (typeof node === 'string') return undefined
  if (node.props.key === key) return node
  for (const child of node.children) {
    const found = keyed(child, key)
    if (found) return found
  }
  return undefined
}

/** Every string under a node, joined. */
const textOf = (node: Node | string): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''))

/** The cards drawn, by agent id. */
const drawnCards = (tree: Node) => {
  const out: string[] = []
  const walk = (node: Node | string) => {
    if (typeof node === 'string') return
    const key = node.props.key
    if (typeof key === 'string' && key.startsWith('card:')) out.push(key.slice('card:'.length))
    node.children.forEach(walk)
  }
  walk(tree)
  return out
}

/** Where a drawn card sits in the region. */
const placed = (tree: Node, id: string) => {
  const node = keyed(tree, `card:${id}`)
  expect(node, `card ${id} drawn`).toBeDefined()
  return { left: node!.props.left as number, top: node!.props.top as number, node: node! }
}

// --------------------------------------------------------------- layout

describe('orgLayout', () => {
  test('one agent: one card at the top left, the chart its size, no connectors', () => {
    const L = orgLayoutOf([MAIN], 84)
    expect(L.cards.map(c => [c.agent.id, c.x, c.y, c.depth])).toEqual([['main', 0, 0, 0]])
    expect([L.width, L.height, L.hidden, L.focus]).toEqual([CARD_W, CARD_H, 0, HALF])
    expect(L.segments).toEqual([])
    expect(orgSizeOf([MAIN], 84)).toEqual({ columns: 84, rows: CARD_H })
    expectSound(L, 'one agent')
  })

  test('four children with room for one row: under the Orchestrator, centred, one bus joining all four', () => {
    const L = orgLayoutOf([MAIN, ...team(4)], 120)
    const top = CARD_H + GAP_Y
    expect(['k1', 'k2', 'k3', 'k4'].map(id => at(L, id))).toEqual([0, 28, 56, 84].map(x => ({ x, y: top })))
    expect(at(L, 'main')).toEqual({ x: 42, y: 0 })
    expect([L.width, L.height]).toEqual([109, 14])
    // the stem under the Orchestrator, then the bus over the four, a drop at each one's centre
    expect(wireRow(L, CARD_H, 54, 54)).toBe('│')
    expect(wireRow(L, CARD_H + 1, 12, 96)).toBe(`┌${'─'.repeat(27)}┬${'─'.repeat(13)}┴${'─'.repeat(13)}┬${'─'.repeat(27)}┐`)
    expectSound(L, 'four children')
  })

  test('nested children sit under their parent, joined to it; the path to a running agent is coloured', () => {
    const agents = [MAIN, agent('A', 'main', 'running'), agent('B', 'main'), agent('A1', 'A', 'running'), agent('A2', 'A')]
    const L = orgLayoutOf(agents, 84)
    expect(L.cards.map(c => [c.agent.id, c.x, c.y, c.depth])).toEqual([
      ['main', 28, 0, 0],
      ['A', 14, 8, 1],
      ['A1', 0, 16, 2],
      ['A2', 28, 16, 2],
      ['B', 56, 8, 1],
    ])
    expect([L.width, L.height]).toEqual([81, 22])
    // the bus under the Orchestrator: blue from A to the stem, grey on to B
    const bus = L.segments.filter(s => s.y === CARD_H + 1 && !s.down)
    expect(bus).toEqual([
      { x: 26, y: 7, glyphs: `┌${'─'.repeat(13)}┴`, down: false, heat: 2 },
      { x: 41, y: 7, glyphs: `${'─'.repeat(27)}┐`, down: false, heat: 0 },
    ])
    // A's own bus: blue toward A1, which runs
    expect(L.segments.filter(s => s.y === 15).map(s => [s.x, s.glyphs, s.heat])).toEqual([
      [12, `┌${'─'.repeat(13)}┴`, 2],
      [27, `${'─'.repeat(13)}┐`, 0],
    ])
    expectSound(L, 'nested')
  })

  test('three children: one row at 84 columns; at 68, a row of two and the third right under the trunk', () => {
    const agents = [MAIN, ...team(3)]
    const wide = orgLayoutOf(agents, 84)
    expect(['k1', 'k2', 'k3'].map(id => at(wide, id))).toEqual([0, 28, 56].map(x => ({ x, y: 8 })))
    expect([wide.width, wide.height, at(wide, 'main').x]).toEqual([81, 14, 28])
    expect(wireRow(wide, 7, 12, 68)).toBe(`┌${'─'.repeat(27)}┼${'─'.repeat(27)}┐`)

    const narrow = orgLayoutOf(agents, 68)
    expect(['k1', 'k2', 'k3'].map(id => at(narrow, id))).toEqual([
      { x: 0, y: 8 },
      { x: 28, y: 8 },
      { x: 14, y: 16 },
    ])
    expect([narrow.width, narrow.height, at(narrow, 'main').x]).toEqual([53, 22, 14])
    // the trunk runs down the gap between k1 and k2, straight into k3
    expect(wireRow(narrow, 7, 12, 40)).toBe(`┌${'─'.repeat(13)}┼${'─'.repeat(13)}┐`)
    for (let y = 8; y <= 15; y++) expect(wireRow(narrow, y, 26, 26), `the trunk at row ${y}`).toBe('│')
    expect(orgSizeOf(agents, 84)).toEqual({ columns: 84, rows: 14 })
    expect(orgSizeOf(agents, 68)).toEqual({ columns: 68, rows: 22 })
    expectSound(wide, 'three at 84')
    expectSound(narrow, 'three at 68')
  })

  test('four children wrap into two rows of two at both 68 and 84 columns, the trunk down the middle gap', () => {
    for (const columns of [68, 84]) {
      const L = orgLayoutOf([MAIN, ...team(4)], columns)
      expect(['main', 'k1', 'k2', 'k3', 'k4'].map(id => at(L, id)), `at ${columns}`).toEqual([
        { x: 14, y: 0 },
        { x: 0, y: 8 },
        { x: 28, y: 8 },
        { x: 0, y: 16 },
        { x: 28, y: 16 },
      ])
      expect([L.width, L.height]).toEqual([53, 22])
      expect(wireRow(L, 7, 12, 40)).toBe(`┌${'─'.repeat(13)}┼${'─'.repeat(13)}┐`)
      expect(wireRow(L, 15, 12, 40)).toBe(`┌${'─'.repeat(13)}┴${'─'.repeat(13)}┐`)
      for (let y = 8; y <= 14; y++) expect(wireRow(L, y, 26, 26), `the trunk at row ${y}`).toBe('│')
      expectSound(L, `four at ${columns}`)
    }
  })

  test('five children: 2, 2 and 1 at 68 columns; 2 then 3 at 84, the longer row last so the trunk passes the shorter', () => {
    const agents = [MAIN, ...team(5)]
    const narrow = orgLayoutOf(agents, 68)
    expect(['k1', 'k2', 'k3', 'k4', 'k5'].map(id => at(narrow, id))).toEqual([
      { x: 0, y: 8 },
      { x: 28, y: 8 },
      { x: 0, y: 16 },
      { x: 28, y: 16 },
      { x: 14, y: 24 },
    ])
    expect([narrow.width, narrow.height]).toEqual([53, 30])

    const wide = orgLayoutOf(agents, 84)
    expect(['main', 'k1', 'k2', 'k3', 'k4', 'k5'].map(id => at(wide, id))).toEqual([
      { x: 28, y: 0 },
      { x: 14, y: 8 },
      { x: 42, y: 8 },
      { x: 0, y: 16 },
      { x: 28, y: 16 },
      { x: 56, y: 16 },
    ])
    expect([wide.width, wide.height]).toEqual([81, 22])
    expectSound(narrow, 'five at 68')
    expectSound(wide, 'five at 84')
  })

  test('a wrapped level puts its leaves first: an agent with children of its own goes in the last row, under the trunk', () => {
    const agents = [MAIN, agent('A', 'main'), agent('b1', 'main'), agent('b2', 'main'), ...team(2, 'A', 'A')]
    const L = orgLayoutOf(agents, 68)
    expect(['b1', 'b2', 'A', 'A1', 'A2'].map(id => at(L, id).y)).toEqual([8, 8, 16, 24, 24])
    expect(mid(card(L, 'A'))).toBe(mid(card(L, 'main')))
    expect(L.width).toBeLessThanOrEqual(68)
    expectSound(L, 'leaves first')
  })
})

describe('orgLayout, past one screen', () => {
  test('a chart too wide even wrapped: the Orchestrator centred, a pan that stops at either edge, a note that says how', () => {
    const L = orgLayoutOf(WIDE, 68)
    expect([L.width, L.height, L.focus]).toEqual([109, 30, 54])
    expect(orgSizeOf(WIDE, 68)).toEqual({ columns: 68, rows: 31 })
    const view = orgViewOf(L, 68, 31)
    expect(view).toEqual({ x: 34 - 54, y: 0, columns: 68, rows: 30, panX: 0, panY: 0, note: 'drag or arrow keys to pan, Home centres' })
    // the Orchestrator's centre at the region's
    expect(view.x + L.focus).toBe(34)
    expect(orgViewOf(L, 68, 31, { x: 100, y: 0 })).toMatchObject({ x: 0, panX: 20 })
    expect(orgViewOf(L, 68, 31, { x: -100, y: 0 })).toMatchObject({ x: 68 - 109, panX: -21 })
    // it fits down: no pan down
    expect(orgViewOf(L, 68, 31, { x: 0, y: -5 })).toMatchObject({ y: 0, panY: 0 })
    // shorter than the chart: it pans down too, as far as its last row
    expect(orgViewOf(L, 68, 20, { x: 0, y: -100 })).toMatchObject({ y: 19 - 30, panY: -11, rows: 19 })
    expectSound(L, 'wide')
  })

  test('a chart that fits is centred and does not pan; no note', () => {
    const L = orgLayoutOf([MAIN, ...team(4)], 84)
    expect(orgViewOf(L, 84, 22, { x: 9, y: 9 })).toEqual({ x: 15, y: 0, columns: 84, rows: 22, panX: 0, panY: 0, note: '' })
    // before the region is laid out (0 across), the chart's own width
    expect(orgSizeOf([MAIN, ...team(4)], 0)).toEqual({ columns: 109, rows: 14 })
  })

  test('past 60 agents: the first 60 breadth first, so the upper levels stay whole and every parent drawn; "+10 more"', () => {
    const grandkids = Array.from({ length: 60 }, (_, i) => agent(`g${i}`, `k${(i % 9) + 1}`))
    const agents = [MAIN, ...team(9), ...grandkids]
    const L = orgLayoutOf(agents, 84)
    expect([L.cards.length, L.hidden]).toEqual([MAX_AGENTS, 10])
    const drawn = new Set(L.cards.map(c => c.agent.id))
    for (let i = 1; i <= 9; i++) expect(drawn.has(`k${i}`), `k${i}`).toBe(true)
    for (const c of L.cards) if (c.depth > 0) expect(drawn.has(c.agent.parent!), `the parent of ${c.agent.id}`).toBe(true)
    // the cut falls among the last parents' children: all of k1's, none of k9's
    expect(grandkids.filter(g => g.parent === 'k1').every(g => drawn.has(g.id))).toBe(true)
    expect(grandkids.filter(g => g.parent === 'k9').some(g => drawn.has(g.id))).toBe(false)
    expect(orgSizeOf(agents, 84).rows).toBe(L.height + 1)
    expect(orgViewOf(L, 84, 40).note).toBe('+10 more · drag or arrow keys to pan, Home centres')
    expectSound(L, 'capped')
  })

  test('another root (a peer, an agent whose parent is gone) stands beside the Orchestrator, which comes first; a parent cycle starts a tree', () => {
    const agents = [agent('x', 'y'), agent('y', 'x'), agent('lost', 'gone'), MAIN, agent('k1', 'main')]
    const L = orgLayoutOf(agents, 84)
    expect(L.cards.map(c => [c.agent.id, c.depth])).toEqual([
      ['main', 0],
      ['k1', 1],
      ['lost', 0],
      ['x', 0],
      ['y', 1],
    ])
    expect(L.focus).toBe(mid(card(L, 'main')))
    expect(at(L, 'lost').x).toBeGreaterThan(at(L, 'main').x + CARD_W)
    expectSound(L, 'roots')
  })

  test('props are plain data from another thread: junk is dropped, the first of an id kept, an unknown status is idle', () => {
    const raw: unknown = [null, 3, 'x', {}, { id: '' }, { id: 'a', status: 'weird', label: 7 }, { id: 'a', label: 'twice' }, { id: 'b', parent: 'a', model: null, status: 'running' }]
    expect(orgAgentsOf(raw)).toEqual([
      { id: 'a', label: '7', type: '', model: '', tokens: '', status: 'idle', now: '', parent: null },
      { id: 'b', label: '', type: '', model: '', tokens: '', status: 'running', now: '', parent: 'a' },
    ])
    expect(orgAgentsOf('nope')).toEqual([])
    expect(orgAgentsOf(undefined)).toEqual([])
    expect(orgLayoutOf(raw as OrgAgent[], 84).cards.map(c => c.agent.id)).toEqual(['a', 'b'])
    expect(orgLayoutOf([], 84)).toMatchObject({ width: 0, height: 0, cards: [], segments: [], hidden: 0 })
    expect(orgSizeOf([], 84)).toEqual({ columns: 84, rows: 1 })
  })

  test('random trees at 68, 84 and 120 columns, and unwrapped: never two cards overlapping, never a connector through a card, every child joined to its parent', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const agents = randomTeam(seed, 2 + (seed % 44))
      for (const columns of [68, 84, 120, 0]) {
        const L = orgLayoutOf(agents, columns)
        expect(L.cards.length).toBe(agents.length)
        expectSound(L, `seed ${seed} at ${columns}`)
      }
    }
  })
})

describe('orgLayout, hit-test and clipping', () => {
  test('a cell hits the card it is in, the pan applied; a cell off every card, outside the region or on the note row hits none', () => {
    const L = orgLayoutOf([MAIN, ...team(4)], 84)
    const view = orgViewOf(L, 84, 22)
    // the Orchestrator at (14, 0) in the chart, the chart 15 in
    expect(orgCardAt(L, view, 29, 0)).toBe('main')
    expect(orgCardAt(L, view, 29 + CARD_W - 1, CARD_H - 1)).toBe('main')
    expect(orgCardAt(L, view, 28, 0)).toBeNull()
    expect(orgCardAt(L, view, 29 + CARD_W, 0)).toBeNull()
    expect(orgCardAt(L, view, 29, CARD_H)).toBeNull()
    expect(orgCardAt(L, view, 15, 8)).toBe('k1')
    expect(orgCardAt(L, view, 15 + CARD_W + 1, 8)).toBeNull()
    expect(orgCardAt(L, view, -1, 0)).toBeNull()
    expect(orgCardAt(L, view, 84, 0)).toBeNull()
    expect(orgCardAt(L, view, 20, 22)).toBeNull()

    const wide = orgLayoutOf(WIDE, 68)
    const panned = orgViewOf(wide, 68, 31, { x: -5, y: 0 })
    expect(panned.x).toBe(-25)
    expect(orgCardAt(wide, panned, 42 - 25, 0)).toBe('main')
    // twenty rows: the chart takes nineteen, the note the last; B1 is under both
    const short = orgViewOf(wide, 68, 20)
    const b1 = short.x + at(wide, 'B1').x + 2
    expect(at(wide, 'B1').y).toBe(16)
    expect(orgCardAt(wide, short, b1, 18)).toBe('B1')
    expect(orgCardAt(wide, short, b1, 19)).toBeNull()
  })

  test('a view keeps only what shows: a run across or down cut at the region edges, a card off it left out', () => {
    const V = (x: number, y: number) => ({ x, y, columns: 20, rows: 10, panX: 0, panY: 0, note: '' })
    const across = { x: 10, y: 3, glyphs: '┌───┐', down: false, heat: 0 as const }
    expect(orgSegmentIn(across, V(-12, 0))).toEqual({ x: 0, y: 3, glyphs: '──┐', down: false })
    expect(orgSegmentIn(across, V(7, 0))).toEqual({ x: 17, y: 3, glyphs: '┌──', down: false })
    expect(orgSegmentIn(across, V(0, -4))).toBeNull()
    expect(orgSegmentIn(across, V(-15, 0))).toBeNull()
    const down = { x: 5, y: 2, glyphs: '││││', down: true, heat: 2 as const }
    expect(orgSegmentIn(down, V(0, -4))).toEqual({ x: 5, y: 0, glyphs: '││', down: true })
    expect(orgSegmentIn(down, V(0, 6))).toEqual({ x: 5, y: 8, glyphs: '││', down: true })
    expect(orgSegmentIn(down, V(-6, 0))).toBeNull()

    const L = orgLayoutOf(WIDE, 68)
    const atRight = orgViewOf(L, 68, 31, { x: -100, y: 0 })
    // A, A1 and A3 end left of the region's edge
    expect(orgCardsIn(L, atRight).map(c => c.agent.id).sort()).toEqual(['A2', 'B', 'B1', 'B2', 'main'])
  })

  test('a card has four lines that fit inside its border: one line each, cut with an ellipsis, its status when it has no now line', () => {
    const long = agent('x', null, 'waiting', { label: 'A very long agent name that goes on', now: '', model: '', tokens: '' })
    expect(orgCardLinesOf(long)).toEqual({ name: 'A very long agent …', type: 'general-purpose', meta: '—', now: 'Waiting' })
    const lines = orgCardLinesOf(agent('y', null, 'running', { label: '', now: 'line one\nline two\ttabbed' }))
    expect(lines).toEqual({ name: 'y', type: 'general-purpose', meta: 'opus-5.5 · 12k', now: 'line one line two ta…' })
    for (const text of Object.values(lines)) expect(Array.from(text).length).toBeLessThanOrEqual(CARD_TEXT)
  })
})

// ---------------------------------------------------------- the module

describe('org.client', () => {
  test('a click on a card posts { type: "open", id }, hit-tested by cell; a click off the cards, or a right click, posts nothing', () => {
    const ui = mount({ agents: [MAIN, ...team(4)], selected: null }, 84, 22)
    const k1 = placed(ui.tree, 'k1')
    expect([k1.left, k1.top]).toEqual([15, 8])
    ui.pointer({ type: 'down', x: k1.left + 2, y: k1.top + 1, button: 'left' })
    ui.pointer({ type: 'up', x: k1.left + 2, y: k1.top + 1, button: 'left' })
    expect(ui.posts).toEqual([{ type: 'open', id: 'k1' }])

    // the corner cell of the Orchestrator's card is on it
    const main = placed(ui.tree, 'main')
    ui.pointer({ type: 'down', x: main.left + CARD_W - 1, y: main.top + CARD_H - 1, button: 'left' })
    ui.pointer({ type: 'up', x: main.left + CARD_W - 1, y: main.top + CARD_H - 1, button: 'left' })
    expect(ui.posts).toEqual([
      { type: 'open', id: 'k1' },
      { type: 'open', id: 'main' },
    ])

    // the gap between k1 and k2, and a right click on k1: nothing
    ui.pointer({ type: 'down', x: k1.left + CARD_W + 1, y: k1.top + 1, button: 'left' })
    ui.pointer({ type: 'up', x: k1.left + CARD_W + 1, y: k1.top + 1, button: 'left' })
    ui.pointer({ type: 'down', x: k1.left + 2, y: k1.top + 1, button: 'right' })
    ui.pointer({ type: 'up', x: k1.left + 2, y: k1.top + 1, button: 'right' })
    // an up with no down of its own (it went down outside) opens nothing either
    ui.pointer({ type: 'up', x: k1.left + 2, y: k1.top + 1, button: 'left' })
    expect(ui.posts).toHaveLength(2)
  })

  test('a drag pans a chart wider than its region and opens nothing; past an edge it stops there; new props keep the pan', () => {
    const ui = mount({ agents: WIDE, selected: null }, 68, 31)
    const start = placed(ui.tree, 'main').left
    expect(start).toBe(-20 + 42)
    ui.pointer({ type: 'down', x: start + 3, y: 2, button: 'left' })
    ui.pointer({ type: 'move', x: start - 2, y: 2, button: 'left' })
    ui.pointer({ type: 'move', x: start - 7, y: 3, button: 'left' })
    ui.pointer({ type: 'up', x: start - 7, y: 3, button: 'left' })
    expect(ui.posts).toEqual([])
    // across only: the chart fits down
    expect([placed(ui.tree, 'main').left, placed(ui.tree, 'main').top]).toEqual([start - 10, 0])

    ui.props({ agents: WIDE.map(a => ({ ...a, now: `${a.now}, later` })), selected: 'B' })
    expect(placed(ui.tree, 'main').left).toBe(start - 10)

    // far past the right edge: the chart's right edge stops at the region's
    ui.pointer({ type: 'down', x: 60, y: 2, button: 'left' })
    ui.pointer({ type: 'move', x: -200, y: 2, button: 'left' })
    ui.pointer({ type: 'up', x: -200, y: 2, button: 'left' })
    expect(placed(ui.tree, 'main').left).toBe(68 - 109 + 42)
    // what is off the region is not drawn: A, A1 and A3 end left of it now
    expect(drawnCards(ui.tree).sort()).toEqual(['A2', 'B', 'B1', 'B2', 'main'])
  })

  test('the arrow keys pan (shift: a card at a time), Home centres again; a chart that fits does not move', () => {
    const ui = mount({ agents: WIDE, selected: null }, 68, 31)
    const left = () => placed(ui.tree, 'main').left
    const start = left()
    ui.key({ key: 'right' })
    expect(left()).toBe(start - 6)
    ui.key({ key: 'left' })
    ui.key({ key: 'left' })
    expect(left()).toBe(start + 6)
    ui.key({ key: 'left', shift: true })
    // the chart's left edge at the region's: no further
    expect(left()).toBe(42)
    ui.key({ key: 'down' })
    ui.key({ key: 'pagedown' })
    expect(placed(ui.tree, 'main').top).toBe(0)
    ui.key({ key: 'home' })
    expect(left()).toBe(start)

    const fits = mount({ agents: [MAIN, ...team(4)], selected: null }, 84, 22)
    const before = placed(fits.tree, 'main')
    for (const key of ['left', 'right', 'up', 'down', 'pageup']) fits.key({ key })
    fits.pointer({ type: 'down', x: 2, y: 2, button: 'left' })
    fits.pointer({ type: 'move', x: 30, y: 9, button: 'left' })
    fits.pointer({ type: 'up', x: 30, y: 9, button: 'left' })
    expect([placed(fits.tree, 'main').left, placed(fits.tree, 'main').top]).toEqual([before.left, before.top])
  })

  test('a chart taller than its region pans down to its last row, and its note takes the bottom row', () => {
    const ui = mount({ agents: WIDE, selected: null }, 68, 20)
    expect(textOf(ui.tree.children[1]!)).toBe('drag or arrow keys to pan, Home centres')
    ui.key({ key: 'down', shift: true })
    expect(placed(ui.tree, 'A3').top).toBe(24 - 8)
    ui.key({ key: 'pagedown' })
    // the chart's last row on the region's last chart row (19 of 20, the note under it)
    expect(placed(ui.tree, 'A3').top + CARD_H).toBe(19)
    ui.key({ key: 'home' })
    expect(placed(ui.tree, 'main').top).toBe(0)
  })

  test('the card under a resting pointer takes a tint, kept when new props redraw it; the selected card a brighter border', () => {
    const ui = mount({ agents: [MAIN, ...team(4)], selected: null }, 84, 22)
    const k2 = placed(ui.tree, 'k2')
    ui.pointer({ type: 'move', x: k2.left + 1, y: k2.top + 1 })
    expect(placed(ui.tree, 'k2').node.props).toMatchObject({ backgroundColor: '#262626', borderColor: '#525252' })
    expect(placed(ui.tree, 'k1').node.props.backgroundColor).toBeUndefined()

    ui.props({ agents: [MAIN, ...team(4)], selected: 'k3' })
    expect(placed(ui.tree, 'k2').node.props.backgroundColor).toBe('#262626')
    expect(placed(ui.tree, 'k3').node.props.borderColor).toBe('#d4d4d4')
    expect(placed(ui.tree, 'k4').node.props.borderColor).toBe('#2a2a2a')
    // the Orchestrator runs: selected, its blue border brighter
    ui.props({ agents: [MAIN, ...team(4)], selected: 'main' })
    expect(placed(ui.tree, 'main').node.props.borderColor).toBe('#93c5fd')

    ui.pointer({ type: 'leave', x: 0, y: 0 })
    expect(placed(ui.tree, 'k2').node.props.backgroundColor).toBeUndefined()
  })

  test('each card: the status dot and bold name, the dim type, the dim model and tokens, the now line; its border grey or its status hue', () => {
    const statuses: OrgStatus[] = ['starting', 'running', 'waiting', 'done', 'failed', 'idle']
    const agents = [MAIN, ...statuses.map(s => agent(s, 'main', s))]
    const ui = mount({ agents, selected: null }, 200, 14)
    const border = { starting: '#3b82f6', running: '#3b82f6', waiting: '#f59e0b', done: '#2a2a2a', failed: '#ef4444', idle: '#2a2a2a' }
    const dot = { starting: '#3b82f6', running: '#3b82f6', waiting: '#f59e0b', done: '#22c55e', failed: '#ef4444', idle: '#a8aeb2' }
    for (const s of statuses) {
      const { node } = placed(ui.tree, s)
      expect(node.props, s).toMatchObject({ position: 'absolute', width: CARD_W, height: CARD_H, borderStyle: 'round', borderColor: border[s] })
      const [first, type, meta, now] = node.children as Node[]
      expect((first!.children[0] as Node).props.color, s).toBe(dot[s])
      expect((first!.children[1] as Node).props.bold).toBe(true)
      expect([first, type, meta, now].map(line => textOf(line!))).toEqual([`● ${s}`, 'general-purpose', 'opus-5.5 · 12k', `on ${s}`])
      expect([type!.props.dimColor, meta!.props.dimColor, now!.props.dimColor]).toEqual([true, true, undefined])
    }
  })

  test('only what shows is drawn: every connector inside the region, the cards on it', () => {
    const ui = mount({ agents: WIDE, selected: null }, 68, 31)
    const chart = ui.tree.children[0] as Node
    expect(chart.props).toMatchObject({ width: 68, height: 30, overflow: 'hidden' })
    for (const part of chart.children as Node[]) {
      const left = part.props.left as number
      const top = part.props.top as number
      if (typeof part.props.key === 'string') continue
      const across = part.props.flexDirection === 'column' ? 1 : textOf(part).length
      const down = part.props.flexDirection === 'column' ? part.children.length : 1
      expect(left >= 0 && left + across <= 68 && top >= 0 && top + down <= 30, `a connector at ${left},${top}`).toBe(true)
    }
    expect(drawnCards(ui.tree).length).toBe(8)
  })

  test('70 agents: 60 cards laid out, those on the region drawn, "+10 more" on the bottom row', () => {
    const agents = [MAIN, ...team(9), ...Array.from({ length: 60 }, (_, i) => agent(`g${i}`, `k${(i % 9) + 1}`))]
    const ui = mount({ agents, selected: null }, 84, 40)
    const note = ui.tree.children[1] as Node
    expect(textOf(note)).toBe('+10 more · drag or arrow keys to pan, Home centres')
    expect(note.props.dimColor).toBe(true)
    expect(drawnCards(ui.tree).length).toBeLessThan(MAX_AGENTS)
    expect(drawnCards(ui.tree)).toContain('main')
  })

  test('no agents, or props that are not the shape: a dim line, never a throw; before its first layout it draws 80 across', () => {
    expect(textOf(mount({ agents: [], selected: null }, 84, 10).tree)).toBe('No agents yet.')
    expect(textOf(mount(null as unknown as Props, 84, 10).tree)).toBe('No agents yet.')
    expect(textOf(mount({ agents: 'x', selected: 3 } as unknown as Props, 84, 10).tree)).toBe('No agents yet.')

    const ui = mount({ agents: [MAIN, ...team(4)], selected: null }, 0, 0)
    expect(ui.tree.props).toMatchObject({ width: 80, height: 22 })
    ui.resize(84, 22)
    expect(placed(ui.tree, 'main').left).toBe(29)
  })
})
