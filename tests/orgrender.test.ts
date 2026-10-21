/**
 * The org chart as the surfaces draw it, where it once drew nothing.
 *
 * - Its rows: the desktop measures a Client's region by what the instance
 *   last drew (the region's holder fits its drawing; the Client's `height`
 *   sizes the box around it), so a fresh instance is told 1 row. A chart
 *   drawn to `surface.rows` drew one row, the pan hint alone, each time the
 *   Org tab opened in a pane on screen. It draws the rows its props carry.
 * - Its bound: the desktop draws nothing of a tree of 2000 elements or more,
 *   its strings counted. Every chart the views can ask for stays far under,
 *   and a drawing never passes MAX_NODES.
 * - Its connectors: a run down one Text of lines, a run across cut at its
 *   junctions, each on its own cells (the desktop's box-drawing glyphs are
 *   about 1.17 cells wide).
 *
 * The module is driven here as a surface drives it (as tests/org.test.ts
 * does), and through the deck, by the kit's own surface runtime.
 */
import type { ClientKeyEvent, ClientPointerEvent, JsonValue } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import * as M from '../hooks/model'
import Org from '../hooks/ui/v2/org.client'
import { MOST_MOVING } from '../hooks/ui/v2/orgChart'
import {
  CARD_H,
  CARD_W,
  CARD_TEXT,
  MAX_AGENTS,
  MAX_NODES,
  MAX_ROWS,
  NODES,
  PROP_TEXT,
  orgCardLinesOf,
  orgCardsIn,
  orgLayoutOf,
  orgPiecesOf,
  orgPropsOf,
  orgSegmentIn,
  orgViewOf,
  type OrgAgent,
  type OrgProps,
  type OrgStatus,
} from '../hooks/ui/v2/orgLayout'
import type { DeckData } from '../types'
import { deck, newWorld, NOW, world } from './world'

// ------------------------------------------------------------- fixtures

function agent(id: string, parent: string | null, status: OrgStatus = 'done', more: Partial<OrgAgent> = {}): OrgAgent {
  return { id, label: id, type: 'general-purpose', model: 'opus-5.5', tokens: '12k', status, now: `on ${id}`, parent, ...more }
}

const MAIN = agent('main', null, 'running', { label: 'Orchestrator', type: 'main loop' })

/** The Orchestrator and `n - 1` agents straight under it. */
const flat = (n: number) => [MAIN, ...Array.from({ length: n - 1 }, (_, i) => agent(`k${i + 1}`, 'main', i % 3 === 0 ? 'running' : 'done'))]

/** The Orchestrator, four agents under it, the rest under those four in turn. */
function nested(n: number) {
  const out = [MAIN]
  for (let i = 1; i < n; i++) out.push(agent(`a${i}`, i < 5 ? 'main' : `a${1 + ((i - 5) % 4)}`, i % 2 ? 'running' : 'waiting'))
  return out
}

/** A seeded tree of `size`: each agent under the Orchestrator or an earlier agent. */
function random(seed: number, size: number) {
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
  for (let i = 1; i < size; i++) out.push(agent(`r${i}`, rand() < 0.45 ? 'main' : out[Math.floor(rand() * out.length)]!.id, statuses[Math.floor(rand() * statuses.length)]!))
  return out
}

const KINDS = { flat, nested, random: (n: number) => random(n * 7 + 1, n) }
const COUNTS = [2, 4, 8, 12, 16, 24, 32, 48, 60]
const WIDTHS = [68, 84, 120, 244]

// ------------------------------------------------- a surface of the test's

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] }

const tag =
  (type: string) =>
  (props: Record<string, unknown>): Node => {
    const { children, ...rest } = props
    const flatten = (value: unknown): (Node | string)[] =>
      Array.isArray(value) ? value.flatMap(flatten) : value === null || value === undefined || value === false ? [] : [value as Node | string]
    return { type, props: rest, children: flatten(children) }
  }
const ELEMENTS = { Box: tag('Box'), Text: tag('Text'), Button: tag('Button'), Input: tag('Input'), Select: tag('Select'), Link: tag('Link'), Code: tag('Code'), Markdown: tag('Markdown') }

type Pan = { panX: number; panY: number }

/** One drawing, its region measured `columns` by `rows` (the desktop's first measure: 1 row), its pan given. */
function drawn(props: OrgProps, columns: number, rows: number, pan: Pan = { panX: 0, panY: 0 }): Node {
  const surface = {
    elements: ELEMENTS,
    state: { ...pan, hover: null, drag: null },
    setState: () => {},
    columns,
    rows,
    every: () => () => {},
    onPointer: (_fn: (event: ClientPointerEvent) => void) => () => {},
    onKey: (_fn: (event: ClientKeyEvent) => void) => () => {},
    post: (_data: JsonValue) => {},
  } as unknown as Parameters<typeof Org>[1]
  return Org(props, surface) as unknown as Node
}

/** The elements of a tree as the desktop counts them: every element and every string child. */
const desktopCount = (node: Node | string): number => (typeof node === 'string' ? 1 : 1 + node.children.reduce((sum, child) => sum + desktopCount(child), 0))

const textOf = (node: Node | string): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''))

/** The cards drawn, by agent id. */
function cardsOf(node: Node | string, out: Node[] = []): Node[] {
  if (typeof node === 'string') return out
  if (typeof node.props.key === 'string' && node.props.key.startsWith('card:')) out.push(node)
  node.children.forEach(child => cardsOf(child, out))
  return out
}

/** The connector glyph drawn in each region cell (`x,y`), from the chart's parts; a cell drawn twice is listed. */
function drawnWires(tree: Node): { cells: Map<string, string>; twice: string[]; faults: string[] } {
  const cells = new Map<string, string>()
  const twice: string[] = []
  const faults: string[] = []
  const put = (x: number, y: number, glyph: string) => {
    const cell = `${x},${y}`
    if (cells.has(cell)) twice.push(cell)
    cells.set(cell, glyph)
  }
  const chart = tree.children[0] as Node
  for (const part of chart.children as Node[]) {
    if (typeof part.props.key === 'string') continue
    const left = part.props.left as number
    const top = part.props.top as number
    const text = textOf(part)
    if (typeof part.props.width === 'number') {
      // a stretch across: clipped to its cells, in a box twice as wide, so it never wraps
      const inner = part.children[0] as Node
      if (part.props.overflow !== 'hidden' || part.props.height !== 1) faults.push(`a stretch at ${left},${top} not clipped to its row`)
      if (Array.from(text).length !== part.props.width) faults.push(`a stretch at ${left},${top} of ${Array.from(text).length} glyphs in ${part.props.width} cells`)
      if (!(typeof inner.props.width === 'number' && inner.props.width >= 2 * part.props.width && inner.props.flexShrink === 0)) faults.push(`a stretch at ${left},${top} that may wrap`)
      if (!/^─+$/.test(text)) faults.push(`a stretch at ${left},${top} of ${text}`)
      Array.from(text).forEach((glyph, i) => put(left + i, top, glyph))
      continue
    }
    const lines = text.split('\n')
    if (lines.some(line => Array.from(line).length !== 1)) faults.push(`a part at ${left},${top} not one glyph a line: ${JSON.stringify(text)}`)
    lines.forEach((glyph, i) => put(left, top + i, glyph))
  }
  return { cells, twice, faults }
}

/** The connector glyph each region cell should show, from the layout. */
function layoutWires(agents: OrgAgent[], laidIn: number, columns: number, rows: number, more: number, pan: Pan): Map<string, string> {
  const layout = orgLayoutOf(agents, laidIn)
  const view = orgViewOf(layout, columns, rows, { x: pan.panX, y: pan.panY }, more)
  const cells = new Map<string, string>()
  for (const segment of layout.segments) {
    const shown = orgSegmentIn(segment, view)
    if (!shown) continue
    Array.from(shown.glyphs).forEach((glyph, i) => cells.set(shown.down ? `${shown.x},${shown.y + i}` : `${shown.x + i},${shown.y}`, glyph))
  }
  return cells
}

/** Pans across and down a chart: where it starts, a step in, far each way. */
const PANS: Pan[] = [
  { panX: 0, panY: 0 },
  { panX: -13, panY: -9 },
  { panX: 40, panY: -500 },
  { panX: -500, panY: -21 },
  { panX: 500, panY: 0 },
]

// --------------------------------------------------------------- the rows

describe('org chart rows', () => {
  test('told 1 row (the desktop`s first measure of a fresh Client), the chart still draws every row the views gave it; told those rows, the same drawing', () => {
    for (const [kind, make] of Object.entries(KINDS)) {
      for (const n of [2, 5, 9, 20]) {
        for (const columns of [68, 95, 244]) {
          const props = orgPropsOf(make(n), null, columns)
          const what = `${kind} ${n} at ${columns}`
          for (const first of [1, 0]) {
            const tree = drawn(props, columns, first)
            expect(tree.props, what).toMatchObject({ width: columns, height: props.rows })
            const chart = tree.children[0] as Node
            const note = tree.children[1]
            expect((chart.props.height as number) + (note ? 1 : 0), what).toBe(props.rows)
            const layout = orgLayoutOf(props.agents, columns)
            const view = orgViewOf(layout, columns, props.rows, { x: 0, y: 0 }, props.more)
            expect(cardsOf(tree).length, what).toBe(orgCardsIn(layout, view).length)
            expect(cardsOf(tree).length, what).toBeGreaterThan(0)
            expect(JSON.stringify(drawn(props, columns, props.rows)), what).toBe(JSON.stringify(tree))
          }
        }
      }
    }
  })

  test('orgPropsOf: the first 60 agents breadth first, the rest "+N more"; every string one line of 48 characters at most; the rows the chart takes, 40 at most', () => {
    const long = (i: number) => `${'x'.repeat(i % 7)} line ${i}\n${'word '.repeat(400)}`
    const many = [MAIN, ...Array.from({ length: 499 }, (_, i) => agent(`m${i}`, i < 30 ? 'main' : `m${i % 30}`, 'running', { label: long(i), now: long(i + 1), type: long(i + 2), model: long(i + 3) }))]
    const props = orgPropsOf(many, 'm3', 84)
    expect(props.agents).toHaveLength(MAX_AGENTS)
    expect(props.more).toBe(500 - MAX_AGENTS)
    expect(props).toMatchObject({ selected: 'm3', rows: MAX_ROWS, columns: 84 })
    // the Orchestrator and the 30 under it first, then the first of their children
    expect(props.agents.slice(0, 31).map(a => a.id)).toEqual(['main', ...Array.from({ length: 30 }, (_, i) => `m${i}`)])
    for (const a of props.agents) {
      for (const text of [a.label, a.type, a.model, a.tokens, a.now]) {
        expect(Array.from(text).length).toBeLessThanOrEqual(PROP_TEXT)
        expect(text).not.toContain('\n')
      }
      // a card shows from the props what it shows from the agent
      expect(orgCardLinesOf(a)).toEqual(orgCardLinesOf(many.find(m => m.id === a.id)!))
    }
    expect(JSON.stringify(props).length).toBeLessThan(30_000)
    const tree = drawn(props, 84, 1)
    expect(textOf(tree.children[1]!)).toBe(`+${500 - MAX_AGENTS} more · drag or arrow keys to pan, Home centres`)

    // a chart that fits: all of it, its own rows, nothing more
    const small = orgPropsOf(flat(5), null, 84)
    expect(small).toMatchObject({ rows: 22, columns: 84, more: 0 })
    expect(small.agents).toEqual(flat(5))
    expect(orgPropsOf([], null, 84)).toMatchObject({ agents: [], rows: 1, more: 0 })
    expect(CARD_TEXT).toBeLessThan(PROP_TEXT)
  })

  test('a card the chart`s bottom edge cuts is clipped to the rows it shows, so the note`s row under the chart stays clear', () => {
    let cut = 0
    for (const n of [9, 16, 30]) {
      for (const columns of [68, 84]) {
        const props = { ...orgPropsOf(flat(n), null, columns), rows: 20 }
        for (const pan of PANS) {
          const tree = drawn(props, columns, 1, pan)
          const chartRows = (tree.children[0] as Node).props.height as number
          expect(tree.children[1], 'the note').toBeDefined()
          for (const card of cardsOf(tree)) {
            const top = card.props.top as number
            const height = card.props.height as number
            expect(top + height, `${card.props.key} at ${top}`).toBeLessThanOrEqual(chartRows)
            if (height < CARD_H) {
              cut += 1
              expect(card.props).toMatchObject({ position: 'absolute', overflow: 'hidden', height: chartRows - top })
              expect((card.children[0] as Node).props).toMatchObject({ height: CARD_H, borderStyle: 'round', flexShrink: 0 })
            }
          }
        }
      }
    }
    expect(cut).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------- the desktop's bound

describe('org chart bound', () => {
  test('2 to 60 agents at 68, 84, 120 and 244 columns, panned anywhere: under MAX_NODES elements as the desktop counts them, far under its 2000', () => {
    let most = 0
    for (const [kind, make] of Object.entries(KINDS)) {
      for (const n of COUNTS) {
        for (const columns of WIDTHS) {
          const props = orgPropsOf(make(n), null, columns)
          for (const pan of PANS) {
            const count = desktopCount(drawn(props, columns, 1, pan))
            most = Math.max(most, count)
            expect(count, `${kind} ${n} at ${columns}, panned ${pan.panX},${pan.panY}`).toBeLessThan(MAX_NODES)
          }
        }
      }
    }
    expect(MAX_NODES).toBeLessThan(2000)
    // the widest chart the views ask for: 60 agents across 244 columns, near 850
    expect(most).toBeGreaterThan(500)
  })

  test('a region far taller than the views give: never past MAX_NODES; the cards first, connectors in what room is left', () => {
    for (const [kind, make] of Object.entries(KINDS)) {
      for (const columns of WIDTHS) {
        const props = { ...orgPropsOf(make(60), null, columns), rows: 200 }
        const tree = drawn(props, columns, 1)
        const what = `${kind} 60 at ${columns}`
        expect(desktopCount(tree), what).toBeLessThanOrEqual(MAX_NODES)
        const layout = orgLayoutOf(props.agents, columns)
        const view = orgViewOf(layout, columns, 200, { x: 0, y: 0 }, props.more)
        expect(cardsOf(tree).length, what).toBe(orgCardsIn(layout, view).length)
        // what connectors there are sit on their cells
        const wires = drawnWires(tree)
        const should = layoutWires(props.agents, columns, columns, 200, props.more, { panX: 0, panY: 0 })
        expect(wires.faults, what).toEqual([])
        for (const [cell, glyph] of wires.cells) expect(should.get(cell), `${what} ${cell}`).toBe(glyph)
      }
    }
    // the cost of each part as the module draws it
    const one = drawn(orgPropsOf(flat(1), null, 84), 84, 1)
    expect(desktopCount(one)).toBe(NODES.frame - 2 + NODES.card)
  })
})

// ------------------------------------------------------------ connectors

describe('org chart connectors', () => {
  test('every connector cell that shows drawn once, on its own cell: a run down one Text of one glyph a line, a run across cut at its junctions, each stretch of ─ clipped to its cells', () => {
    for (const [kind, make] of Object.entries(KINDS)) {
      for (const n of [3, 8, 17, 40]) {
        for (const columns of WIDTHS) {
          const props = orgPropsOf(make(n), null, columns)
          for (const pan of PANS) {
            const what = `${kind} ${n} at ${columns}, panned ${pan.panX},${pan.panY}`
            const wires = drawnWires(drawn(props, columns, 1, pan))
            expect(wires.faults, what).toEqual([])
            expect(wires.twice, what).toEqual([])
            const should = layoutWires(props.agents, columns, columns, props.rows, props.more, pan)
            expect([...wires.cells].sort(), what).toEqual([...should].sort())
          }
        }
      }
    }
  })

  test('a run across in pieces: each stretch of ─ one piece, every other glyph one of its own', () => {
    expect(orgPiecesOf('┌────┴───┬──┐')).toEqual([
      { at: 0, glyphs: '┌' },
      { at: 1, glyphs: '────' },
      { at: 5, glyphs: '┴' },
      { at: 6, glyphs: '───' },
      { at: 9, glyphs: '┬' },
      { at: 10, glyphs: '──' },
      { at: 12, glyphs: '┐' },
    ])
    expect(orgPiecesOf('──')).toEqual([{ at: 0, glyphs: '──' }])
    expect(orgPiecesOf('┼')).toEqual([{ at: 0, glyphs: '┼' }])
    expect(orgPiecesOf('')).toEqual([])
  })
})

// ------------------------------------------------------- through the deck

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane<S extends 'terminal' | 'desktop'>(surface: S, bodyColumns = 96) {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId: 'agent-deck',
    viewport: { columns: bodyColumns + 4, rows: 60, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }
}

/** A session of `n` agents: the Orchestrator running, three under it, the rest under those three. */
function sessionOf(n: number): DeckData {
  const data = M.emptyData(NOW - 600_000)
  M.agentOf(data, M.MAIN)!.status = 'running'
  for (let i = 1; i < n; i++) {
    const parentId = i <= 3 ? M.MAIN : `agent-${1 + ((i - 4) % 3)}`
    data.agents.push(M.newAgent(`agent-${i}`, 'agent', `worker ${i}`, NOW - 400_000 + i, { type: 'general-purpose', parentId, status: i % 2 ? 'running' : 'completed', description: `Task ${i}` }))
  }
  return data
}

type Drawing = { press: (target: { key: string }) => Promise<unknown>; redraw: () => Promise<void> }

async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

/** Every element keyed `card:` in a plain tree. */
function cardKeys(tree: unknown, out: string[] = []): string[] {
  if (!tree || typeof tree !== 'object') return out
  const node = tree as { props?: { key?: unknown }; children?: unknown[] }
  if (typeof node.props?.key === 'string' && node.props.key.startsWith('card:')) out.push(node.props.key)
  for (const child of node.children ?? []) cardKeys(child, out)
  return out
}

test('through the deck, on a desktop pane too narrow for the chart of its own: the Org tab`s Client, measured 1 row tall as the desktop first measures it, draws its chart, and the same told its rows; the terminal lists the tree', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  world(on, newWorld(), { v: M.SNAPSHOT_VERSION, data: M.copyOf(sessionOf(7)), view: M.defaultView() })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await clock.advance(1000)

  const ui = await $.ui.mount(pane('desktop', 24))
  await press(ui, 'tab:org')
  expect(await ui.find({ key: 'org:chart' })).toBeUndefined()
  const client = await ui.find({ type: 'Client' })
  expect(client?.key).toBe('org')
  const height = client?.props.height as number
  const props = client?.props.props as Required<OrgProps>
  expect(props.rows).toBe(height)
  expect(props.columns).toBe(24)
  expect(height).toBeGreaterThan(CARD_H * 2)

  // the desktop's first measure of a fresh Client: its region's holder holds nothing yet, 1 row
  await ui.resize({ columns: 24, rows: 1, in: 'org' })
  const tree = (await ui.drawn({ in: 'org' })) as unknown as { props: Record<string, unknown> }
  expect(tree.props).toMatchObject({ height })
  expect(cardKeys(tree)).toContain('card:main')
  // told what it drew, it draws the same
  await ui.resize({ columns: 24, rows: height, in: 'org' })
  expect(JSON.stringify(await ui.drawn({ in: 'org' }))).toBe(JSON.stringify(tree))
  await press(ui, 'tab:now')
  await ui.unmount()

  // the terminal runs Clients too, but lists Org as the tree, each agent's glyph in its colour
  const terminal = await $.ui.mount(pane('terminal'))
  await press(terminal, 'tab:org')
  expect(await terminal.find({ type: 'Client' })).toBeUndefined()
  expect(await terminal.find({ key: 'org:tree' })).toBeDefined()
  await press(terminal, 'tab:now')
  await terminal.unmount()
})

/** The elements a drawn tree holds, its strings counted as the desktop counts them. */
function nodesOf(node: unknown): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node !== 'object') return 1
  const children = (node as { children?: unknown[] }).children ?? []
  return 1 + children.reduce((sum: number, child) => sum + nodesOf(child), 0)
}

/** The characters a drawn tree holds: its strings and its string props (an Svg's document too). */
function charsOf(node: unknown): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node !== 'object') return String(node).length
  const props = (node as { props?: Record<string, unknown> }).props ?? {}
  const own = Object.values(props).reduce((sum: number, value) => sum + (typeof value === 'string' ? value.length : 0), 0)
  return own + ((node as { children?: unknown[] }).children ?? []).reduce((sum: number, child) => sum + charsOf(child), 0)
}

test('the desktop`s own chart keeps inside the pane`s bounds: 60 agents nested under three, at the usual width and the widest, as wide as the pane at most, under 2000 elements and 90k characters, 24 avatars moving at most', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  world(on, newWorld(), { v: M.SNAPSHOT_VERSION, data: M.copyOf(sessionOf(60)), view: M.defaultView() })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await clock.advance(1000)

  for (const columns of [84, 244]) {
    const ui = await $.ui.mount(pane('desktop', columns))
    await press(ui, 'tab:org')
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    const chart = await ui.find({ key: 'org:chart' })
    expect(chart?.props.width).toBe(columns - 1)
    const cards = (await ui.findAll({ type: 'Box' })).filter(box => (box.key ?? '').startsWith('org:card:'))
    expect(cards).toHaveLength(60)
    for (const card of cards) expect((card.props.left as number) + CARD_W).toBeLessThanOrEqual(columns - 1)
    const faces = (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).endsWith("'s avatar"))
    expect(faces).toHaveLength(60)
    expect(faces.filter(svg => svg.props.isInteractive === true)).toHaveLength(MOST_MOVING)
    const drawn = await ui.drawn()
    expect(nodesOf(drawn)).toBeLessThan(2000)
    expect(charsOf(drawn)).toBeLessThan(90_000)
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})
