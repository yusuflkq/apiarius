import type { On, PaneOpenArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = 1_700_000_100_000
const PROBE = 'apiarius-probe'
const COPPER = '#c9824f'

const PROBE_PANE = {
  title: 'Deck probe',
  isFocused: true,
  bodyColumns: 96,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

const VIEWPORT = { columns: 100, rows: 50, isFullscreen: true }

/** /apiarius as typed at the prompt, with what the engine stamps on it. */
function deck(args: string) {
  return { command: 'apiarius', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 100 } }
}

/**
 * Answers every engine call the deck makes, in Claude Code's place, outside
 * any repository; keeps the panes open as the engine would (`ui.panes`
 * lists them, each shown), recording each open and close.
 */
function world(on: On, opened: PaneOpenArgs[] = [], closed: string[] = []) {
  const open = new Set<string>()
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: true, isPlaced: true })) }))
  on('ui.open', ($, e) => {
    open.add(e.id)
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    open.delete(e.id)
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } } }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: NOW, isLink: false } }))
  on('fs.read', () => ({ value: '' }))
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** The element keyed `key` in a drawn tree, depth first. */
function keyed(tree: unknown, key: string): Node | undefined {
  if (!tree || typeof tree !== 'object') return undefined
  const node = tree as Node
  if (node.props?.key === key) return node
  for (const child of node.children ?? []) {
    const found = keyed(child, key)
    if (found) return found
  }
  return undefined
}

/** Every string a drawn tree shows, in order. */
function textOf(tree: unknown): string {
  if (typeof tree === 'string') return tree
  if (!tree || typeof tree !== 'object') return ''
  return ((tree as Node).children ?? []).map(textOf).join('\n')
}

test('/apiarius probe opens a pane of its own with the keyboard (Esc closes it); /apiarius probe again closes it, and its ui.close stops the tick', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const opened: PaneOpenArgs[] = []
  const closed: string[] = []
  world(on, opened, closed)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  expect((await $.command.run(deck('probe'))).text).toBeUndefined()
  expect(opened).toEqual([{ id: PROBE, title: 'Deck probe', focus: true, closeOnEscape: true, rows: 24 }])

  const ui = await $.ui.mount({ plugin: 'apiarius', surface: 'desktop', component: 'Pane', requestId: PROBE, viewport: VIEWPORT, props: PROBE_PANE })
  const clientProps = async () => (await ui.find({ type: 'Client', key: 'probe' }))?.props.props
  expect(await clientProps()).toEqual({ tick: 0, cols: 96 })
  await clock.advance(1500)
  expect(await clientProps()).toEqual({ tick: 1, cols: 96 })
  await clock.advance(1500)
  expect(await clientProps()).toEqual({ tick: 2, cols: 96 })

  // closed: the tick stops with the pane
  expect((await $.command.run(deck('probe'))).text).toBe('Deck probe closed.')
  expect(closed).toEqual([PROBE])
  await clock.advance(6000)
  await ui.redraw()
  expect(await clientProps()).toEqual({ tick: 2, cols: 96 })

  // opened afresh: the tick starts over
  await $.command.run(deck('probe'))
  expect(opened.map(one => one.id)).toEqual([PROBE, PROBE])
  await clock.advance(1500)
  expect(await clientProps()).toEqual({ tick: 1, cols: 96 })
  expect((await $.command.run(deck('probe'))).text).toBe('Deck probe closed.')
  expect(closed).toEqual([PROBE, PROBE])
  await ui.unmount()
})

test('the probe on each surface: its numbers and a hex colour in native Text, a Client that keeps its clicks across ticks and posts to ui.message, an Svg where the surface has one', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('probe'))

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'apiarius', surface, component: 'Pane', requestId: PROBE, viewport: VIEWPORT, props: PROBE_PANE })

    // (a) the site's numbers, then copper as a raw hex colour
    expect(await ui.find({ type: 'Text', text: `bodyColumns=96  viewport=100×50  placement=dock  bodyRows=40  surface=${surface}` })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'copper hex' }))?.props.color).toBe(COPPER)

    // (b) the Client across the body, its module as written
    const client = await ui.find({ type: 'Client', key: 'probe' })
    expect(client?.props.width).toBe('100%')
    expect(String(client?.props.module)).toMatch(/probe\.client\.tsx$/)
    const tick = (client?.props.props as { tick: number }).tick
    expect(client?.props.props).toEqual({ tick, cols: 96 })
    expect(await ui.find({ type: 'Text', text: `100×50 · clicks 0 · tick ${tick} · key none`, in: 'probe' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^(0123456789){10}$/, in: 'probe' })).toBeDefined()

    // (c) the Svg, an image (no isInteractive), where the surface has one
    const svg = await ui.find({ type: 'Svg' })
    if (surface === 'desktop') {
      expect(svg?.props.isInteractive).toBeUndefined()
      expect(String(svg?.props.source)).toContain('width="2400" height="160" viewBox="0 0 900 60"')
      expect(String(svg?.props.source)).toContain('fill="#161615"')
      expect(String(svg?.props.source)).toContain(`font-size="13" fill="#e9e4d8">tick ${tick} &#183; this text is 13px</text>`)
    } else {
      expect(svg).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'No Svg on terminal.' })).toBeDefined()
    }

    // a pointer down on r0c0: one click, that box copper with dark text, its cell posted to the hooks module
    await ui.pointer({ type: 'down', x: 3, y: 3, button: 'left', in: 'probe' })
    const drawn = await ui.drawn({ in: 'probe' })
    expect(textOf(drawn)).toContain('clicks 1')
    expect(keyed(drawn, 'r0c0')?.props?.backgroundColor).toBe(COPPER)
    expect(keyed(drawn, 'r0c1')?.props?.backgroundColor).toBeUndefined()
    expect(keyed(drawn, 'r1c0')?.props?.backgroundColor).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'r0c0', in: 'probe' })).toMatchObject({ props: { color: '#161615' } })
    expect(await ui.find({ type: 'Text', text: 'ui.message: {"box":[0,0],"x":3,"y":3}' })).toBeDefined()

    await ui.key({ key: 'left', in: 'probe' })
    expect(await ui.find({ type: 'Text', text: `100×50 · clicks 1 · tick ${tick} · key left`, in: 'probe' })).toBeDefined()

    // a tick redraws the pane: its new props reach the instance, the clicks and the copper box kept
    await clock.advance(1500)
    expect(await ui.find({ type: 'Text', text: `100×50 · clicks 1 · tick ${tick + 1} · key left`, in: 'probe' })).toBeDefined()
    expect((await ui.find({ key: 'r0c0', in: 'probe' }))?.props.backgroundColor).toBe(COPPER)

    // the far corner: r3c3 turns copper, r0c0 back to none
    await ui.pointer({ type: 'down', x: 39, y: 13, button: 'left', in: 'probe' })
    expect((await ui.find({ key: 'r3c3', in: 'probe' }))?.props.backgroundColor).toBe(COPPER)
    expect((await ui.find({ key: 'r0c0', in: 'probe' }))?.props.backgroundColor).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'ui.message: {"box":[3,3],"x":39,"y":13}' })).toBeDefined()

    // the ruler follows the region's width, one digit a cell
    await ui.resize({ columns: 43, rows: 14, in: 'probe' })
    expect(await ui.find({ type: 'Text', text: `43×14 · clicks 2 · tick ${tick + 1} · key left`, in: 'probe' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^(0123456789){4}012$/, in: 'probe' })).toBeDefined()
    await ui.unmount()
  }
})

test('a fault: its dim line says when and why, the surface it failed on leaves the Client out, and /apiarius probe twice draws it again', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('probe'))

  const desktop = await $.ui.mount({ plugin: 'apiarius', surface: 'desktop', component: 'Pane', requestId: PROBE, viewport: VIEWPORT, props: PROBE_PANE })
  expect(await desktop.find({ type: 'Text', text: 'ui.message: none yet' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: 'ui.fault: none' })).toBeDefined()

  // a region absurdly wide: the ruler takes the tree past its 100,000 characters, and the instance fails drawing
  await desktop.resize({ columns: 200_000, rows: 14, in: 'probe' })
  expect(await desktop.find({ type: 'Text', text: /^ui\.fault: render on desktop: \S/ })).toBeDefined()
  expect(await desktop.find({ type: 'Client' })).toBeUndefined()
  expect(await desktop.find({ type: 'Text', text: /left out here after its fault/ })).toBeDefined()
  await desktop.unmount()

  // the terminal's Client did not fail: it still draws there
  const terminal = await $.ui.mount({ plugin: 'apiarius', surface: 'terminal', component: 'Pane', requestId: PROBE, viewport: VIEWPORT, props: PROBE_PANE })
  expect(await terminal.find({ type: 'Client', key: 'probe' })).toBeDefined()
  await terminal.unmount()

  // closed and opened again: the Client is back, the fault forgotten
  await $.command.run(deck('probe'))
  await $.command.run(deck('probe'))
  const again = await $.ui.mount({ plugin: 'apiarius', surface: 'desktop', component: 'Pane', requestId: PROBE, viewport: VIEWPORT, props: PROBE_PANE })
  expect(await again.find({ type: 'Client', key: 'probe' })).toBeDefined()
  expect(await again.find({ type: 'Text', text: 'ui.fault: none' })).toBeDefined()
  await again.unmount()
})
