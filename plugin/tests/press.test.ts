/**
 * A click on the pane lands the first time. The engine draws a site again
 * whenever its props change, `isFocused` too, which the click that gives the
 * pane the keyboard flips; every Button built anew gets a new press handle,
 * and the engine lets the old ones go before the click arrives from the
 * drawing the Desktop still shows (it holds the new one back until the
 * pointer is up). So a draw the deck did not ask for hands back the tree it
 * drew last (hooks/renderMemo.ts), and every handle stays; what the deck
 * draws anew (a press, a new minute) still draws anew.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { newRenderMemo } from '../hooks/renderMemo'
import { deck, newWorld, NOW, world } from './world'

const SURFACES = ['desktop', 'terminal'] as const
type Surface = (typeof SURFACES)[number]

const PANE = { title: 'Apiarius', isFocused: false, bodyColumns: 96, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
const BAND = { hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const VIEWPORT = { columns: 100, rows: 60, isFullscreen: true }

function pane(surface: Surface) {
  return { plugin: 'apiarius', surface, component: 'Pane' as const, requestId: 'apiarius', viewport: VIEWPORT, props: PANE }
}

function band(surface: Surface) {
  return { plugin: 'apiarius', surface, component: 'AbovePrompt' as const, viewport: VIEWPORT, props: BAND }
}

type Node = { type?: string; props?: Record<string, unknown>; press?: { handle?: unknown }; children?: unknown[] }

/** Each Button's press handle in a drawn tree, by its key. */
function handles(tree: unknown, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (!tree || typeof tree !== 'object') return out
  const node = tree as Node
  if (node.type === 'Button') out[String(node.props?.key)] = node.press?.handle
  for (const child of node.children ?? []) handles(child, out)
  return out
}

/** A fresh session, the pane opened with /apiarius. */
async function opened($: Engine, on: On) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  world(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await clock.advance(1000)
  return clock
}

test('the click that gives the pane the keyboard keeps every Button`s press handle: the draw isFocused asks for (or a scroll) hands back the same tree', async ($, on) => {
  await opened($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const before = handles(await ui.drawn())
    expect(Object.keys(before)).toEqual(expect.arrayContaining(['tab:now', 'tab:chat', 'tab:settings', 'agent:main']))
    expect(Object.values(before).every(handle => typeof handle === 'number')).toBe(true)

    await ui.redraw({ ...PANE, isFocused: true })
    expect(handles(await ui.drawn())).toEqual(before)
    await ui.redraw({ ...PANE, isFocused: true, scroll: { offset: 4, bodyRows: 60 } })
    expect(handles(await ui.drawn())).toEqual(before)
    await ui.redraw({ ...PANE, isFocused: false })
    expect(handles(await ui.drawn())).toEqual(before)

    // a pane of another width is drawn for it (its cards narrower, so "Open →" may stand aside), and a press on it lands
    const stable = (keys: string[]) => keys.filter(key => !key.startsWith('card:open:'))
    await ui.redraw({ ...PANE, bodyColumns: 140 })
    expect(stable(Object.keys(handles(await ui.drawn())))).toEqual(stable(Object.keys(before)))
    await ui.press({ key: 'tab:chat' })
    await ui.redraw({ ...PANE, bodyColumns: 140 })
    expect((await ui.find({ key: 'tab:chat' }))?.props.dimColor).toBe(false)
    await ui.press({ key: 'tab:now' })
    await ui.unmount()
  }
})

test('a press on a tree handed back runs the newest view`s closure, and what it changes is drawn anew, its handles then kept in turn', async ($, on) => {
  await opened($, on)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.redraw({ ...PANE, isFocused: true })
  const now = handles(await ui.drawn())

  // the Orchestrator's row: its page, Back at the top
  await ui.press({ key: 'agent:main' })
  await ui.redraw({ ...PANE, isFocused: true })
  expect(await ui.find({ key: 'key:b' })).toBeDefined()
  const page = handles(await ui.drawn())
  expect(page['tab:now']).not.toBe(now['tab:now'])

  // the pressed button is gone, so the pane lets the keyboard go and takes it back: the page keeps its handles
  await ui.redraw({ ...PANE, isFocused: false })
  await ui.redraw({ ...PANE, isFocused: true })
  expect(handles(await ui.drawn())).toEqual(page)

  // Back, then Chat: each press lands on the tree handed back
  await ui.press({ key: 'key:b' })
  await ui.redraw({ ...PANE, isFocused: true })
  expect(await ui.find({ key: 'key:b' })).toBeUndefined()
  expect((await ui.find({ key: 'agent:main' }))?.props.label).toBe('Orchestrator')
  await ui.press({ key: 'tab:chat' })
  await ui.redraw({ ...PANE, isFocused: false })
  expect((await ui.find({ key: 'tab:chat' }))?.props.dimColor).toBe(false)
  expect((await ui.find({ key: 'tab:now' }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('a card`s time changes with the minute, not with the draw: a new minute draws the pane anew, a focus flip inside one does not', async ($, on) => {
  const clock = await opened($, on)
  await $.prompt.submit({ text: 'Fix the off-by-one in src/range.js', origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text: 'Fix the off-by-one in src/range.js', turnId: 't1' })
  await clock.advance(1000)
  const ui = await $.ui.mount(pane('desktop'))
  const first = (await ui.find({ key: 'card:time:main' }))?.props.label
  const firstHandles = handles(await ui.drawn())

  await clock.advance(20_000)
  await ui.redraw({ ...PANE, isFocused: true })
  expect((await ui.find({ key: 'card:time:main' }))?.props.label).toBe(first)
  expect(handles(await ui.drawn())).toEqual(firstHandles)

  await clock.advance(180_000)
  await ui.redraw({ ...PANE, isFocused: false })
  const later = (await ui.find({ key: 'card:time:main' }))?.props.label
  expect(later).not.toBe(first)
  expect(String(later)).toMatch(/3m ago$/)
  await ui.unmount()
})

test('the band keeps its Open button`s handle across a draw it did not ask for', async ($, on) => {
  await opened($, on)
  await $.agent.spawn({
    tool_use_id: 'toolu_scout',
    prompt: 'Look around src/',
    description: 'look around',
    subagentType: 'Explore',
    name: 'scout',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-test',
    background: true,
    fork: false,
  })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    const before = handles(await ui.drawn())
    expect(Object.keys(before)).toEqual(['band:open'])
    await ui.redraw({ ...BAND, isWorking: false })
    expect(handles(await ui.drawn())).toEqual(before)
    await ui.unmount()
  }
})

test('newRenderMemo: the same inputs hand back the same tree, other inputs or a clear build anew, inputs that are not JSON never keep one', async () => {
  const memo = newRenderMemo()
  let built = 0
  const draw = () => ({ n: ++built })
  const first = memo.of('pane:desktop', [96, 'key', { tab: 'dashboard' }], draw)
  expect(memo.of('pane:desktop', [96, 'key', { tab: 'dashboard' }], draw)).toBe(first)
  expect(built).toBe(1)
  // each site keeps its own
  expect(memo.of('pane:terminal', [96, 'key', { tab: 'dashboard' }], draw)).toEqual({ n: 2 })
  expect(memo.of('pane:desktop', [96, 'key', { tab: 'org' }], draw)).toEqual({ n: 3 })
  expect(memo.of('pane:desktop', [96, 'key', { tab: 'org' }], draw)).toEqual({ n: 3 })
  memo.clear()
  expect(memo.of('pane:desktop', [96, 'key', { tab: 'org' }], draw)).toEqual({ n: 4 })
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  expect(memo.of('band:desktop', [cyclic], draw)).toEqual({ n: 5 })
  expect(memo.of('band:desktop', [cyclic], draw)).toEqual({ n: 6 })
})
