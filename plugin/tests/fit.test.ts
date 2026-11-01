/**
 * The terminal pane never taller than the terminal: past it, every redraw
 * left stray lines behind. The rows a drawing takes (./ui/v2/fit `rowsOf`),
 * the rows the pane may take (`paneRowsFor`: its room, never past the
 * terminal less what Claude Code needs beside it) and asks for as it opens
 * (`openRowsFor`); and the screens that grow cut to them on the terminal:
 * Chat to its newest messages, the Dashboard's sections folded from the
 * bottom, needs as lines and cards cut. Drawn by `/apiarius demo` over the v2
 * sample.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as M from '../hooks/model'
import { FEWEST_ROWS, SCREEN_RESERVE, openRowsFor, paneRowsFor, rowsOf } from '../hooks/ui/v2/fit'
import * as W from '../hooks/web'
import { SAMPLE_NOW, v2Session } from './v2session'
import { deck, newWorld, world, type World } from './world'

/** The deck's pane on a terminal `screen` rows tall, its room as tall, `bodyColumns` across. */
function terminal(screen: number, bodyColumns = 84) {
  return {
    plugin: 'apiarius',
    surface: 'terminal' as const,
    component: 'Pane' as const,
    requestId: 'apiarius',
    viewport: { columns: bodyColumns + 4, rows: screen, isFullscreen: false },
    props: { title: 'Apiarius', isFocused: true, bodyColumns, placement: 'inline' as const, scroll: { offset: 0, bodyRows: screen }, view: {} },
  }
}

type Drawing = {
  press: (target: { key: string }) => Promise<unknown>
  input: (target: { key: string; text: string; kind?: 'change' | 'submit' }) => Promise<unknown>
  redraw: () => Promise<void>
  drawn: () => Promise<unknown>
  find: (q: { key: string } | { type: 'Input' }) => Promise<{ key?: string; text: string; props: Record<string, unknown> } | undefined>
  findAll: (q: { type: 'Box' | 'Button' }) => Promise<{ key?: string }[]>
  unmount: () => Promise<void>
}

async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

async function keysOf(ui: Drawing, type: 'Box' | 'Button', prefix: string): Promise<string[]> {
  return (await ui.findAll({ type })).map(one => one.key ?? '').filter(key => key.startsWith(prefix))
}

/** `/apiarius demo` over the v2 sample. */
async function demo($: Engine, on: On, w: World = newWorld()) {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const session = v2Session()
  const v2 = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const v1 = W.webStateOf(session.data, M.defaultView(), session.git, session.usage, session.now, session.sessionId, session.cwd)
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.json')) return { value: JSON.stringify(v1) }
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(v2) }
    return { deny: 'no such file' }
  })
  on('ui.focus', () => ({}))
  world(on, w)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  return { clock, v2 }
}

test('rowsOf lays a drawing out as the terminal does, on the safe side: Text wrapped (one row a line where it truncates), a column its children and gaps, a row its tallest, a wrapping row packed, a border two more, a fixed height that height', () => {
  const T = (text: string, props: Record<string, unknown> = {}) => ({ type: 'Text', props, children: [text] })
  const B = (props: Record<string, unknown>, ...children: unknown[]) => ({ type: 'Box', props, children })
  expect(rowsOf(null, 20)).toBe(0)
  expect(rowsOf(T('x'.repeat(40)), 20)).toBe(2)
  expect(rowsOf(T('x'.repeat(41)), 20)).toBe(3)
  expect(rowsOf(T('x'.repeat(40), { wrap: 'truncate-end' }), 20)).toBe(1)
  expect(rowsOf(T('a\nb\nc'), 20)).toBe(3)
  expect(rowsOf({ type: 'Text', props: {}, children: ['ab', { type: 'Text', props: {}, children: ['c'.repeat(20)] }] }, 20)).toBe(2)
  expect(rowsOf(B({ flexDirection: 'column', gap: 1 }, T('a'), T('b'), null, T('c')), 20)).toBe(5)
  expect(rowsOf(B({ flexDirection: 'column', borderStyle: 'round', paddingX: 1 }, T('x'.repeat(36))), 20)).toBe(2 + 3)
  expect(rowsOf(B({ flexDirection: 'row' }, T('a\nb'), T('c')), 20)).toBe(2)
  // a row past its room: the widest part wraps in what the others leave it
  expect(rowsOf(B({ flexDirection: 'row', columnGap: 1 }, T('▸'), T('y'.repeat(30))), 20)).toBe(2)
  expect(rowsOf(B({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 }, ...Array.from({ length: 6 }, () => T('x'.repeat(8)))), 20)).toBe(3)
  expect(rowsOf(B({ flexDirection: 'column', height: 4 }, T('a'), T('b')), 20)).toBe(4)
  expect(rowsOf(B({ flexDirection: 'column', width: '50%' }, T('x'.repeat(20))), 40)).toBe(1)
  expect(rowsOf({ type: 'Button', props: { label: 'Open' }, children: [] }, 20)).toBe(1)
  expect(rowsOf({ type: 'Markdown', props: { text: 'One\n\nTwo' }, children: [] }, 20)).toBe(3)
  // a field: one line, or as many as its `rows`
  expect(rowsOf({ type: 'Input', props: { key: 'f', value: 'x'.repeat(60) } }, 20)).toBe(1)
  expect(rowsOf({ type: 'Input', props: { key: 'f', rows: 3 } }, 20)).toBe(3)
})

test('the rows the pane may take on the terminal: its room, never past the terminal less what Claude Code needs beside it; as it opens, a third of the terminal', () => {
  expect(SCREEN_RESERVE).toBeGreaterThanOrEqual(6)
  expect(paneRowsFor(60, 40)).toBe(40 - SCREEN_RESERVE)
  expect(paneRowsFor(13, 40)).toBe(13)
  expect(paneRowsFor(undefined, 30)).toBe(30 - SCREEN_RESERVE)
  expect(paneRowsFor(20, undefined)).toBe(20)
  expect(paneRowsFor(undefined, undefined)).toBeUndefined()
  expect(paneRowsFor(3, 6)).toBe(FEWEST_ROWS)
  expect(openRowsFor(0)).toBeUndefined()
  expect(openRowsFor(45)).toBe(15)
  expect(openRowsFor(60)).toBe(20)
  expect(openRowsFor(18)).toBe(FEWEST_ROWS)
})

test('/apiarius asks for an inline pane no taller than the terminal its last drawing measured; nothing asked before one has', async ($, on) => {
  const w = newWorld()
  const { clock } = await demo($, on, w)
  // /apiarius demo opened it before any drawing measured the terminal: no rows asked
  expect(w.opens.at(-1)).toEqual({ id: 'apiarius' })
  const ui = (await $.ui.mount(terminal(45))) as unknown as Drawing
  await ui.unmount()
  await $.command.run(deck(''))
  await clock.advance(500)
  expect(w.opens.at(-1)).toEqual({ id: 'apiarius', rows: openRowsFor(45) })
})

/** The lines a long draft's field takes on each terminal: what the newest message leaves it, three at most. */
const GROWN: Record<number, number> = { 30: 1, 45: 3, 60: 3 }

test('on a short terminal the pane keeps inside it: Chat its newest messages that fit, "▲ N earlier" over them (a press the page before, "▼ N newer" beside it back to the newest), a field that grew only into the room the newest leaves; the Dashboard its sections folded from the bottom, needs as lines, cards cut; a folded head makes room for its section', async ($, on) => {
  const { v2 } = await demo($, on)
  const newest = `msg:${v2.chat[v2.chat.length - 1]!.id}`
  for (const screen of [30, 45, 60]) {
    const room = paneRowsFor(screen, screen)!
    const ui = (await $.ui.mount(terminal(screen))) as unknown as Drawing
    // the Dashboard
    expect(rowsOf(await ui.drawn(), 83)).toBeLessThanOrEqual(room)
    expect(await ui.find({ key: 'needs:now' })).toBeDefined()
    expect(await ui.find({ key: 'fold:dash:agents' })).toBeDefined()
    // Chat: the newest message, and the rest said
    await press(ui, 'tab:chat')
    expect(rowsOf(await ui.drawn(), 83)).toBeLessThanOrEqual(room)
    const shown = await keysOf(ui, 'Box', 'msg:')
    expect(shown.at(-1)).toBe(newest)
    expect(shown.length).toBeLessThan(v2.chat.length)
    const earlier = v2.chat.length - shown.length
    expect((await ui.find({ key: 'chat:earlier' }))?.props.label).toBe(`▲ ${earlier} earlier`)
    expect(await ui.find({ key: 'chat:newest' })).toBeUndefined()
    // a press: the page before, ending at the message over the oldest shown, "▼ N newer" beside it, still inside the terminal
    await press(ui, 'chat:earlier')
    expect((await keysOf(ui, 'Box', 'msg:')).at(-1)).toBe(`msg:${v2.chat[earlier - 1]!.id}`)
    expect((await ui.find({ key: 'chat:newest' }))?.props.label).toBe(`▼ ${shown.length} newer`)
    expect(rowsOf(await ui.drawn(), 83)).toBeLessThanOrEqual(room)
    // and that one's press: the newest again
    await press(ui, 'chat:newest')
    expect(await keysOf(ui, 'Box', 'msg:')).toEqual(shown)
    expect(await ui.find({ key: 'chat:newest' })).toBeUndefined()
    // a long draft: the field grows to show it (three lines, as far as the newest message leaves it room), and Chat makes room for it, still inside the terminal
    const field = async () => (await ui.find({ type: 'Input' }))?.key ?? ''
    await ui.input({ key: await field(), text: 'tell the builder what the reviewer found in the limiter, and ask it to run the tests again. '.repeat(3), kind: 'change' })
    await ui.redraw()
    expect([screen, Number((await ui.find({ type: 'Input' }))?.props.rows ?? 1)]).toEqual([screen, GROWN[screen]])
    expect(rowsOf(await ui.drawn(), 83)).toBeLessThanOrEqual(room)
    expect((await keysOf(ui, 'Box', 'msg:')).at(-1)).toBe(newest)
    await ui.input({ key: await field(), text: '', kind: 'change' })
    await press(ui, 'tab:now')
    await ui.unmount()
  }
  // a press on a head folded to fit opens its section, the others folding to make room
  const ui = (await $.ui.mount(terminal(45))) as unknown as Drawing
  const room = paneRowsFor(45, 45)!
  expect((await ui.find({ key: 'fold:dash:files' }))?.props.label).toMatch(/^▸ FILES/)
  await press(ui, 'fold:dash:files')
  expect((await ui.find({ key: 'fold:dash:files' }))?.props.label).toMatch(/^▾ FILES/)
  expect(await keysOf(ui, 'Button', 'now:file:')).not.toEqual([])
  expect(rowsOf(await ui.drawn(), 83)).toBeLessThanOrEqual(room)
  await ui.unmount()
  // a tall terminal: every section open, the whole window of Chat
  const tall = (await $.ui.mount(terminal(400))) as unknown as Drawing
  expect((await tall.find({ key: 'fold:dash:files' }))?.props.label).toMatch(/^▾ FILES/)
  expect((await tall.find({ key: 'fold:dash:agents' }))?.props.label).toMatch(/^▾ AGENTS/)
  await tall.unmount()
})
