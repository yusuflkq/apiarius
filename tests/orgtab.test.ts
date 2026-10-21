/**
 * Org (key 3) in the deck, on the v2 state's rows: the chart's Client where
 * the surface runs one (the terminal and the desktop), sized by its props,
 * its agents each under the one that started it; a card it posts opens
 * that agent's page; where no Client draws (VS Code, the mobile app), and
 * where the chart failed (`ui.fault`), the agents as an indented tree, each
 * row opening the page; Now's "Org chart →" one press away. The chart's
 * layout and module themselves are tests/org.test.ts and
 * tests/orgrender.test.ts.
 */
import type { JsonValue, On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { chartAgentsOf, orgFocusKeys } from '../hooks/ui/v2/org'
import { MAX_ROWS, type OrgProps } from '../hooks/ui/v2/orgLayout'
import { treeRowsOf } from '../hooks/ui/v2/orgTree'
import type { Kit } from '../hooks/ui/types'
import * as W from '../hooks/web'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { deck, newWorld, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

function pane<S extends Surface>(surface: S, bodyColumns = 84) {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId: 'agent-deck',
    viewport: { columns: bodyColumns + 4, rows: 60, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }
}

type Drawing = { press: (target: { key: string }) => Promise<unknown>; redraw: () => Promise<void> }

async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

/** The v2 sample as the engine builds it. */
function sampleState(): W.WebStateV2 {
  const session = v2Session()
  return W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
}

/** The engine, the sample served, `/deck demo` shown. */
async function demo($: Engine, on: On, state: W.WebStateV2) {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const session = v2Session()
  const agentFiles = new Map(W.agentFilesOf(session.data).map(one => [one.id, one.text]))
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(state) }
    const agent = /\/web\/fixtures\/v2\/agents\/([^/]+)\.json$/.exec(path)?.[1]
    if (agent && agentFiles.has(agent)) return { value: agentFiles.get(agent)! }
    return { deny: 'no such file' }
  })
  on('ui.focus', () => ({}))
  world(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  return { clock }
}

async function keysOf(ui: { findAll: (q: { type: 'Button' }) => Promise<{ key?: string }[]> }, prefix: string): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith(prefix))
}

test('the tabs are 1 Now · 2 Chat · 3 Org · 4 Changes; Org draws the chart`s Client keyed org, as tall as its props say, its agents each under the one that started it', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.findAll({ type: 'Button' })).filter(one => (one.key ?? '').startsWith('tab:')).map(one => [one.key, one.props.hotkey])).toEqual([
      ['tab:now', '1'],
      ['tab:chat', '2'],
      ['tab:org', '3'],
      ['tab:changes', '4'],
    ])
    await press(ui, 'tab:org')
    expect((await ui.find({ key: 'tab:org' }))?.props).toMatchObject({ label: 'Org', dimColor: false })
    expect((await ui.find({ key: 'tab:now' }))?.props.dimColor).toBe(true)
    const client = await ui.find({ type: 'Client' })
    expect(client?.key).toBe('org')
    expect(String(client?.props.module)).toMatch(/org\.client\.tsx$/)
    const props = client?.props.props as Required<OrgProps>
    expect(props.rows).toBe(client?.props.height)
    expect(props.rows).toBeLessThanOrEqual(MAX_ROWS)
    expect(props.columns).toBe(83)
    expect(props.agents.map(one => [one.id, one.parent])).toEqual(chartAgentsOf(state).map(one => [one.id, one.parent]))
    expect(props.agents[0]).toMatchObject({ id: 'main', parent: null, label: 'Orchestrator' })
    expect(props.agents.find(one => one.id === IDS.tester)?.parent).toBe(IDS.builder)
    expect(props.agents.find(one => one.id === IDS.builder)).toMatchObject({ status: 'waiting', now: 'Bash npm test -- rateLimit', model: 'sonnet-4.5' })
    // the chart draws its cards
    expect(await ui.find({ key: `card:${IDS.builder}`, in: 'org' })).toBeDefined()
    // no Button rows over the chart: j and k have none to move among there
    expect(await keysOf(ui, 'agent:')).toEqual([])
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('a card the chart posts opens that agent`s page, which b leaves for Org, the chart marking it; a post of anything else, or of an agent the pane does not hold, is let go', async ($, on) => {
  await demo($, on, sampleState())
  const ui = await $.ui.mount(pane('desktop'))
  await press(ui, 'tab:org')
  expect(((await ui.find({ type: 'Client' }))?.props.props as OrgProps).selected).toBeNull()
  const junks: JsonValue[] = ['open', { type: 'open' }, { type: 'open', id: 'nobody' }, { type: 'open', id: 'you' }, { type: 'pan', id: IDS.builder }]
  for (const junk of junks) {
    await ui.post(junk, { in: 'org' })
    await ui.redraw()
    expect(await ui.find({ key: 'page:head' })).toBeUndefined()
  }
  await ui.post({ type: 'open', id: IDS.builder }, { in: 'org' })
  await ui.redraw()
  expect((await ui.find({ key: 'page:head' }))?.text).toContain('builder')
  await press(ui, 'key:b')
  expect((await ui.find({ key: 'tab:org' }))?.props.dimColor).toBe(false)
  expect(((await ui.find({ type: 'Client' }))?.props.props as OrgProps).selected).toBe(IDS.builder)
  await press(ui, 'tab:now')
  await ui.unmount()
})

test('where no Client draws (VS Code, the mobile app) Org lists the agents as a tree: each under the one that started it, its pill, its one line, every line opening its page', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:org')
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    const rows = treeRowsOf(state)
    expect(await keysOf(ui, 'agent:')).toEqual(rows.map(({ row }) => W.agentKeyOf(row.id)))
    const tester = rows.find(({ row }) => row.id === IDS.tester)!
    const builder = rows.find(({ row }) => row.id === IDS.builder)!
    expect(tester.depth).toBe(builder.depth + 1)
    expect((await ui.find({ key: `org:${IDS.tester}` }))?.props.paddingLeft).toBe(((await ui.find({ key: `org:${IDS.builder}` }))?.props.paddingLeft as number) + 2)
    expect((await ui.find({ key: `org:${IDS.builder}` }))?.text).toContain('Bash npm test -- rateLimit')
    for (const key of [W.agentKeyOf(IDS.builder), `org:open:${IDS.builder}`, `org:now:${IDS.builder}`]) {
      await press(ui, key)
      expect((await ui.find({ key: 'page:head' }))?.text).toContain('builder')
      await press(ui, 'key:b')
    }
    // the agent opened last is the primary plate
    expect((await ui.find({ key: W.agentKeyOf(IDS.builder) }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'agent:main' }))?.props.plain).toBe(true)
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('where the chart failed (ui.fault) that surface`s Org lists the agents as a tree and says why; leaving Org, or /deck, tries the chart again', async ($, on) => {
  await demo($, on, sampleState())
  const ui = await $.ui.mount(pane('desktop'))
  await press(ui, 'tab:org')
  expect((await ui.find({ type: 'Client' }))?.key).toBe('org')
  // a region absurdly wide: the instance fails drawing, and the engine says so (ui.fault)
  await ui.resize({ columns: 200_000, rows: 400, in: 'org' })
  await ui.redraw()
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^The chart could not draw here, so the agents are listed instead\./ })).toBeDefined()
  expect(await keysOf(ui, 'agent:')).toContain(W.agentKeyOf(IDS.builder))
  // the terminal's chart did not fail
  const terminal = await $.ui.mount(pane('terminal'))
  expect((await terminal.find({ type: 'Client' }))?.key).toBe('org')
  await terminal.unmount()
  // left and come back: the chart again
  await press(ui, 'tab:now')
  await press(ui, 'tab:org')
  expect((await ui.find({ type: 'Client' }))?.key).toBe('org')
  await press(ui, 'tab:now')
  await ui.unmount()
})

test('Now`s agents head has "Org chart →", which opens Org; Org`s rows for j and k are the tree`s agents, none over the chart', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'now:org' }))?.props).toMatchObject({ label: 'Org chart →', plain: true })
  await press(ui, 'now:org')
  expect((await ui.find({ key: 'tab:org' }))?.props.dimColor).toBe(false)
  expect((await ui.find({ type: 'Client' }))?.key).toBe('org')
  await press(ui, 'tab:now')
  await ui.unmount()
  const kit = (client: boolean) => ({ surface: 'desktop', columns: 84, ...(client ? { Client: () => null } : {}) }) as unknown as Kit
  expect(orgFocusKeys(kit(true), state, { isDown: false, selected: null })).toEqual([])
  expect(orgFocusKeys(kit(true), state, { isDown: true, selected: null })).toEqual(treeRowsOf(state).map(({ row }) => W.agentKeyOf(row.id)))
  expect(orgFocusKeys(kit(false), state, { isDown: false, selected: null })).toEqual(treeRowsOf(state).map(({ row }) => W.agentKeyOf(row.id)))
})
