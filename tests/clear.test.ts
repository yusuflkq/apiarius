/**
 * The deck's own tidying: the finished agents (done, failed, stopped or
 * idle) folded behind one "N finished ▸" row on the Dashboard and in Chat's
 * member list, and "Clear finished", which hides every agent finished
 * before it from the Dashboard, the member list, Org and Chat's Everyone,
 * kept in the deck's view through reloads, until "Show N cleared". Nothing
 * of it reaches Claude Code. The state marks what is hidden
 * (`W.clearedStateOf`), so the pane, the terminal and the web page agree.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as M from '../hooks/model'
import * as W from '../hooks/web'
import type { DeckSnapshot } from '../types'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { command, deck, lastState, newWorld, NOW, work, world, type World } from './world'

const SURFACES = ['terminal', 'desktop'] as const

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane(surface: 'terminal' | 'desktop', bodyColumns = 84) {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId: 'agent-deck',
    viewport: { columns: bodyColumns + 4, rows: 400, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} },
  }
}

type Drawing = {
  press: (target: { key: string }) => Promise<unknown>
  redraw: () => Promise<void>
  find: (q: { key: string }) => Promise<{ key?: string; text: string; props: Record<string, unknown> } | undefined>
  findAll: (q: { type: 'Button' }) => Promise<{ key?: string }[]>
  unmount: () => Promise<void>
}

async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

/** The Button keys a drawing holds, in document order, that start with `prefix`. */
async function buttonKeys(ui: Drawing, prefix: string): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith(prefix))
}

/** The sample session's v2 state, as built. */
function sampleState(): W.WebStateV2 {
  const session = v2Session()
  return W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
}

/** The agent rows of a state. */
function rowsOf(state: W.WebStateV2): W.V2AgentRow[] {
  return state.agents.filter((row): row is W.V2AgentRow => row.row === 'agent')
}

/** `/deck demo` over the v2 sample, its reads answered; each snapshot the deck keeps is pushed on `saved`, and a reload reads the last back. */
async function demo($: Engine, on: On, saved: DeckSnapshot[]) {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const session = v2Session()
  const v2 = sampleState()
  const v1 = W.webStateOf(session.data, M.defaultView(), session.git, session.usage, session.now, session.sessionId, session.cwd)
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.json')) return { value: JSON.stringify(v1) }
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(v2) }
    return { deny: 'no such file' }
  })
  on('ui.focus', () => ({}))
  on('state.get', { plugin: 'agent-deck', key: 'snapshot' }, () => ({ value: { value: saved[saved.length - 1], version: saved.length } }))
  on('state.set', { plugin: 'agent-deck', key: 'snapshot' }, ($, e) => {
    saved.push(JSON.parse(JSON.stringify(e.value)) as DeckSnapshot)
    return { value: { isSet: true as const, version: saved.length } }
  })
  world(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  return { clock, v2 }
}

/** A pane mounted, as the tests here press it. */
async function mount($: Engine, surface: 'terminal' | 'desktop'): Promise<Drawing> {
  return (await $.ui.mount(pane(surface))) as unknown as Drawing
}

test('clearedStateOf marks what Clear finished hid: a finished agent it named that ended by then, with nothing under it still shown; one that ran again after shows again; their chat rows; the fold rows count only those shown', () => {
  const state = sampleState()
  const finished = rowsOf(state).filter(row => W.isFinishedRow(row)).map(row => row.id)
  expect([...finished].sort()).toEqual([IDS.docs, IDS.linter, IDS.researcher, IDS.scout, IDS.tester].sort())
  expect(W.finishedIdsOf(state).sort()).toEqual([...finished].sort())
  // nothing cleared: nothing marked
  expect(state.cleared).toEqual({ count: 0, at: null })
  expect(rowsOf(state).some(row => row.isCleared)).toBe(false)

  const cleared = W.clearedStateOf(state, { ids: finished, at: state.now })
  expect(cleared.cleared).toEqual({ count: 5, at: state.now })
  expect(rowsOf(cleared).filter(row => row.isCleared).map(row => row.id).sort()).toEqual([...finished].sort())
  // every row stays in the state (an agent's page, Changes and Inspect keep them); the fold rows of them go
  expect(rowsOf(cleared).length).toBe(rowsOf(state).length)
  expect(cleared.agents.filter(row => row.row === 'fold')).toEqual([])
  expect(W.shownStateOf(cleared).agents.map(row => row.id)).toEqual(rowsOf(state).filter(row => !finished.includes(row.id)).map(row => row.id))
  expect(W.finishedIdsOf(cleared)).toEqual([])
  // their messages (from, to or about one) are marked; the rest are not
  const gone = new Set(finished)
  for (const row of cleared.chat) expect(row.isCleared === true).toBe(gone.has(row.from) || (row.to !== null && gone.has(row.to)) || (row.agent !== undefined && gone.has(row.agent)))
  expect(cleared.chat.some(row => row.isCleared)).toBe(true)
  expect(cleared.chat.some(row => !row.isCleared)).toBe(true)

  // only some cleared: a fold row counts what it still shows
  const one = W.clearedStateOf(state, { ids: [IDS.tester], at: state.now })
  expect(one.agents.find(row => row.row === 'fold' && row.parent === IDS.builder)).toMatchObject({ ids: [IDS.linter], text: '1 failed' })

  // a finished agent with one still at work under it stays (so does the tree); one that ended after the press, or runs again, shows
  const at = state.now
  const base = rowsOf(state).find(row => row.id === IDS.researcher)!
  const row = (id: string, parent: string, status: W.V2AgentRow['status'], endedAt: number | null): W.V2AgentRow => ({ ...base, id, parent, status, isStopped: false, needs: 0, endedAt })
  const tree: W.WebStateV2 = {
    ...state,
    agents: [rowsOf(state)[0]!, row('a', 'main', 'done', at - 1000), row('b', 'a', 'running', null), row('c', 'main', 'done', at - 1000), row('d', 'main', 'done', at + 1000), row('e', 'main', 'running', null)],
    chat: [],
  }
  const tidied = W.clearedStateOf(tree, { ids: ['a', 'c', 'd', 'e'], at })
  expect(rowsOf(tidied).filter(one => one.isCleared).map(one => one.id)).toEqual(['c'])
  expect(tidied.cleared.count).toBe(1)
  // b done before the press too: a and b go together
  const both = W.clearedStateOf({ ...tree, agents: [rowsOf(state)[0]!, row('a', 'main', 'done', at - 1000), row('b', 'a', 'done', at - 500)] }, { ids: ['a', 'b'], at })
  expect(rowsOf(both).filter(one => one.isCleared).map(one => one.id)).toEqual(['a', 'b'])
})

test('Clear finished, on the Dashboard: the finished agents leave the Dashboard, Chat`s members and Everyone, and Org, with "Show 5 cleared" in their row; Show brings them back; kept through a reload', async ($, on) => {
  const saved: DeckSnapshot[] = []
  const { clock, v2 } = await demo($, on, saved)
  const finished = rowsOf(v2).filter(row => W.isFinishedRow(row)).map(row => row.id)
  const front = rowsOf(v2).filter(row => !W.isFinishedRow(row)).sort((x, y) => Number(y.id === 'main') - Number(x.id === 'main') || x.startedAt - y.startedAt)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    if (surface === 'terminal') {
      expect((await ui.find({ key: 'finished:now:fold' }))?.props.label).toBe('5 finished ▸')
      await press(ui, 'finished:now:clear')
      await clock.advance(1000)
      await ui.redraw()
    }
    // the Dashboard: those at work, and in the finished row only "Show 5 cleared"
    expect(await buttonKeys(ui, 'agent:')).toEqual(front.map(row => W.agentKeyOf(row.id)))
    expect(await ui.find({ key: 'finished:now:fold' })).toBeUndefined()
    expect(await ui.find({ key: 'finished:now:clear' })).toBeUndefined()
    expect((await ui.find({ key: 'finished:now:show' }))?.props).toMatchObject({ label: 'Show 5 cleared', plain: true })
    // Chat: no member of them, and nothing of theirs in Everyone
    await press(ui, 'tab:chat')
    const members = await buttonKeys(ui, 'chat:filter:')
    for (const id of finished) expect(members).not.toContain(`chat:filter:${id}`)
    expect(members).toContain(`chat:filter:${IDS.builder}`)
    expect((await ui.find({ key: 'finished:chat:show' }))?.props.label).toBe('Show 5 cleared')
    for (const message of v2.chat.filter(one => gone(one, finished))) expect(await ui.find({ key: `msg:${message.id}` })).toBeUndefined()
    // Org: none of them
    await press(ui, 'tab:org')
    const org = (await ui.find({ key: 'org:tab' }))?.text ?? ''
    for (const id of finished) expect(org).not.toContain(rowsOf(v2).find(one => one.id === id)!.title)
    expect(org).toContain('builder')
    await press(ui, 'tab:now')
    await ui.unmount()
  }
  // kept in the view, so a reload keeps it
  const view = saved[saved.length - 1]!.view.v2
  expect([...view.cleared].sort()).toEqual([...finished].sort())
  expect(view.clearedAt).toBeGreaterThan(0)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.advance(1000)
  const again = await mount($, 'desktop')
  expect(await buttonKeys(again, 'agent:')).toEqual(front.map(row => W.agentKeyOf(row.id)))
  // Show 5 cleared: all of them back, behind their row again
  await press(again, 'finished:now:show')
  await clock.advance(1000)
  await again.redraw()
  expect((await again.find({ key: 'finished:now:fold' }))?.props.label).toBe('5 finished ▸')
  expect(await again.find({ key: 'finished:now:show' })).toBeUndefined()
  await again.unmount()
  expect(saved[saved.length - 1]!.view.v2).toMatchObject({ cleared: [], clearedAt: 0 })
})

/** Whether a chat row is from, to or about one of `ids`. */
function gone(row: W.V2ChatRow, ids: readonly string[]): boolean {
  return ids.includes(row.from) || (row.to !== null && ids.includes(row.to)) || (row.agent !== undefined && ids.includes(row.agent))
}

test('/deck clear and /deck clear show say what they did; with nothing to do they say so', async ($, on) => {
  const saved: DeckSnapshot[] = []
  const { clock } = await demo($, on, saved)
  expect(await $.command.run(deck('clear'))).toMatchObject({ text: 'Cleared 5 finished agents from the deck (Claude Code keeps them). /deck clear show brings them back.' })
  await clock.advance(1000)
  expect(await $.command.run(deck('clear'))).toMatchObject({ text: 'Nothing finished to clear.' })
  expect(await $.command.run(deck('clear show'))).toMatchObject({ text: 'Showing 5 cleared agents again.' })
  expect(await $.command.run(deck('clear show'))).toMatchObject({ text: 'Nothing cleared to show.' })
})

test('the web page`s clearFinished and showCleared: state.json`s v2 marks the cleared and says how many, each with its ack; with nothing to do, failed; nothing reaches Claude Code', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w: World = newWorld()
  world(on, w)
  await work($)
  await $.turn.complete({ turnId: 'turn-x1', answer: 'Found it: the loop ran one past the end.', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-x1' })
  await clock.advance(1000)
  const v2 = () => (lastState(w) as unknown as { v2: W.WebStateV2 }).v2
  expect(rowsOf(v2()).find(row => row.id === 'agent-x1')?.status).toBe('done')
  command(w.children[0], { cmd: 'clearFinished', id: 'cl-1' })
  await clock.settle()
  await clock.advance(1000)
  expect(rowsOf(v2()).find(row => row.id === 'agent-x1')?.isCleared).toBe(true)
  expect(v2().cleared).toMatchObject({ count: 1 })
  expect(v2().acks.find(one => one.id === 'cl-1')).toMatchObject({ ok: true, status: 'delivered', text: 'Cleared 1 finished agent from the deck' })
  command(w.children[0], { cmd: 'clearFinished', id: 'cl-2' })
  await clock.settle()
  await clock.advance(1000)
  expect(v2().acks.find(one => one.id === 'cl-2')).toMatchObject({ ok: false, status: 'failed', text: 'Nothing finished to clear' })
  command(w.children[0], { cmd: 'showCleared', id: 'cl-3' })
  await clock.settle()
  await clock.advance(1000)
  expect(rowsOf(v2()).find(row => row.id === 'agent-x1')?.isCleared).toBeUndefined()
  expect(v2().cleared).toEqual({ count: 0, at: null })
  expect(v2().acks.find(one => one.id === 'cl-3')).toMatchObject({ ok: true, status: 'delivered', text: 'Showing 1 cleared agent again' })
  // nothing of it went to Claude Code
  expect(w.sent).toEqual([])
  expect(w.submitted.filter(one => /clear/i.test(one.text))).toEqual([])
  // the routes the mod reads them by
  expect(W.routeOf({ cmd: 'clearFinished' }, M.emptyData(0))).toEqual({ kind: 'clearFinished' })
  expect(W.routeOf({ cmd: 'showCleared', id: 'x' }, M.emptyData(0))).toEqual({ kind: 'showCleared' })
})
