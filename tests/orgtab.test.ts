/**
 * Org (key 3) in the deck, on the v2 state's rows: on the desktop a chart of
 * the pane's own elements (./orgChart), a card an agent with its avatar
 * where the layout puts it, its name opening its page; where the pane cannot
 * hold that chart, the chart's Client, sized by its props, a card it posts
 * opening that agent's page; on the terminal, VS Code and the mobile app,
 * and where the Client failed (`ui.fault`), the agents as an indented tree,
 * each row opening the page; the Dashboard's "Org chart →" one press away.
 * The chart's layout and Client themselves are tests/org.test.ts and
 * tests/orgrender.test.ts.
 */
import type { JsonValue, On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { chartAgentsOf, orgFocusKeys } from '../hooks/ui/v2/org'
import { CARD_H, CARD_W, MAX_ROWS, orgLayoutOf, orgPiecesOf, type OrgLayout, type OrgProps } from '../hooks/ui/v2/orgLayout'
import { treeRowsOf } from '../hooks/ui/v2/orgTree'
import { P } from '../hooks/ui/v2/palette'
import type { Kit } from '../hooks/ui/types'
import * as W from '../hooks/web'
import * as AV from '../web/avatars.mjs'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { deck, newWorld, world } from './world'

type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

function pane<S extends Surface>(surface: S, bodyColumns = 84) {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId: 'agent-deck',
    viewport: { columns: bodyColumns + 4, rows: 400, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} },
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


/** Box-drawing glyphs alone, a connector's Text: one glyph, a stretch of `─`, or a run down (lines). */
const WIRE = /^[│─┌┐└┘├┤┬┴┼\n]+$/

/** The chart's connector pieces as the pane draws them: a run down one Text, a run across one a junction or a stretch of `─`. */
function wirePiecesOf(layout: OrgLayout): number {
  return layout.segments.reduce((sum, segment) => sum + (segment.down ? 1 : orgPiecesOf(segment.glyphs).length), 0)
}

test('the tabs are 1 Dashboard · 2 Chat · 3 Org · 4 Changes · 5 Settings; on the desktop Org is a chart of the pane`s own elements: a card an agent where the layout puts it, its avatar, its name a Button that opens its page, over box-drawing connectors', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.findAll({ type: 'Button' })).filter(one => (one.key ?? '').startsWith('tab:')).map(one => [one.key, one.props.hotkey])).toEqual([
    ['tab:now', '1'],
    ['tab:chat', '2'],
    ['tab:org', '3'],
    ['tab:changes', '4'],
    ['tab:settings', '5'],
  ])
  await press(ui, 'tab:org')
  expect((await ui.find({ key: 'tab:org' }))?.props).toMatchObject({ label: 'Org', dimColor: false })
  expect((await ui.find({ key: 'tab:now' }))?.props.dimColor).toBe(true)
  // no Client: the pane's own Boxes, so each card can show its avatar
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  const agents = chartAgentsOf(state)
  expect(agents[0]).toMatchObject({ id: 'main', parent: null, label: 'Orchestrator' })
  expect(agents.find(one => one.id === IDS.tester)?.parent).toBe(IDS.builder)
  const layout = orgLayoutOf(agents, 83)
  expect(layout.width).toBeLessThanOrEqual(83)
  expect((await ui.find({ key: 'org:chart' }))?.props).toMatchObject({ width: 83, height: layout.height })
  // each card where the layout puts it, centred in the pane, CARD_W by CARD_H, bordered
  const left = Math.floor((83 - layout.width) / 2)
  for (const card of layout.cards) {
    expect((await ui.find({ key: `org:card:${card.agent.id}` }))?.props).toMatchObject({ position: 'absolute', left: left + card.x, top: card.y, width: CARD_W, height: CARD_H, borderStyle: 'round' })
  }
  // its name a plain Button keyed as the agent's row, in the layout's order; its type, model and tokens, and its one line
  expect(await keysOf(ui, 'agent:')).toEqual(layout.cards.map(card => W.agentKeyOf(card.agent.id)))
  expect((await ui.find({ key: W.agentKeyOf(IDS.builder) }))?.props).toMatchObject({ label: 'builder', plain: true })
  const builder = (await ui.find({ key: `org:card:${IDS.builder}` }))?.text ?? ''
  for (const said of ['general-purpose', 'sonnet-4.5 · ', ' tokens', 'Bash npm test -- rateLimit']) expect(builder).toContain(said)
  // waiting on you: its edge amber, its avatar moving (a frame the Desktop keeps), its status dot at its foot
  expect((await ui.find({ key: `org:card:${IDS.builder}` }))?.props.borderColor).toBe(P.wait)
  const faces = (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).endsWith("'s avatar"))
  expect(faces).toHaveLength(layout.cards.length)
  const builderFace = faces.find(svg => svg.props.alt === "builder's avatar")
  expect(builderFace?.props).toMatchObject({ width: 22, height: 22, isInteractive: true })
  expect(String(builderFace?.props.source)).toContain('@keyframes')
  // one done stands still: an image, no frame
  const done = state.agents.find((row): row is W.V2AgentRow => row.row === 'agent' && row.status === 'done' && !row.isStopped)!
  expect(faces.find(svg => svg.props.alt === `${done.title}'s avatar`)?.props.isInteractive).toBeUndefined()
  // the connectors: a run down one Text of lines, a run across cut at its junctions
  const wires = (await ui.findAll({ type: 'Text' })).filter(text => WIRE.test(text.text))
  expect(wires).toHaveLength(wirePiecesOf(layout))
  expect(wires.some(text => text.text.includes('\n'))).toBe(true)
  // a name opens its page
  await press(ui, W.agentKeyOf(IDS.builder))
  expect((await ui.find({ key: 'page:head' }))?.text).toContain('builder')
  await press(ui, 'key:b')
  await press(ui, 'tab:now')
  await ui.unmount()
})

test('the agent whose page was opened last is marked on the chart; where the pane cannot hold the chart the Client draws it, and what it posts opens that agent`s page, anything else let go', async ($, on) => {
  await demo($, on, sampleState())
  const ui = await $.ui.mount(pane('desktop'))
  await press(ui, 'tab:org')
  expect((await ui.find({ key: `org:card:${IDS.builder}` }))?.props.borderColor).toBe(P.wait)
  await press(ui, W.agentKeyOf(IDS.builder))
  await press(ui, 'key:b')
  expect((await ui.find({ key: 'tab:org' }))?.props.dimColor).toBe(false)
  // the brighter amber of the one marked
  expect((await ui.find({ key: `org:card:${IDS.builder}` }))?.props.borderColor).toBe('#fcd34d')
  await press(ui, 'tab:now')
  await ui.unmount()

  // a pane narrower than a card holds no chart of its own: the chart's Client, which pans
  const narrow = await $.ui.mount(pane('desktop', 24))
  await press(narrow, 'tab:org')
  expect(await narrow.find({ key: 'org:chart' })).toBeUndefined()
  const client = await narrow.find({ type: 'Client' })
  expect(client?.key).toBe('org')
  expect(String(client?.props.module)).toMatch(/org\.client\.tsx$/)
  const props = client?.props.props as Required<OrgProps>
  expect(props.rows).toBe(client?.props.height)
  expect(props.rows).toBeLessThanOrEqual(MAX_ROWS)
  expect(props.columns).toBe(24)
  expect(props.selected).toBe(IDS.builder)
  const junks: JsonValue[] = ['open', { type: 'open' }, { type: 'open', id: 'nobody' }, { type: 'open', id: 'you' }, { type: 'pan', id: IDS.tester }]
  for (const junk of junks) {
    await narrow.post(junk, { in: 'org' })
    await narrow.redraw()
    expect(await narrow.find({ key: 'page:head' })).toBeUndefined()
  }
  await narrow.post({ type: 'open', id: IDS.tester }, { in: 'org' })
  await narrow.redraw()
  expect((await narrow.find({ key: 'page:head' }))?.text).toContain('tester')
  await press(narrow, 'key:b')
  expect(((await narrow.find({ type: 'Client' }))?.props.props as OrgProps).selected).toBe(IDS.tester)
  await press(narrow, 'tab:now')
  await narrow.unmount()
})

test('the terminal, VS Code and the mobile app list Org as a tree: each under the one that started it, its avatar (the terminal`s a coloured glyph), its pill, its one line, every line opening its page', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:org')
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect(await ui.find({ key: 'org:chart' })).toBeUndefined()
    const rows = treeRowsOf(state)
    expect(await keysOf(ui, 'agent:')).toEqual(rows.map(({ row }) => W.agentKeyOf(row.id)))
    const tester = rows.find(({ row }) => row.id === IDS.tester)!
    const builder = rows.find(({ row }) => row.id === IDS.builder)!
    expect(tester.depth).toBe(builder.depth + 1)
    expect((await ui.find({ key: `org:${IDS.tester}` }))?.props.paddingLeft).toBe(((await ui.find({ key: `org:${IDS.builder}` }))?.props.paddingLeft as number) + 2)
    expect((await ui.find({ key: `org:${IDS.builder}` }))?.text).toContain('Bash npm test -- rateLimit')
    if (surface === 'terminal') {
      const face = AV.terminalFace({ id: IDS.builder, status: 'waiting' })
      expect((await ui.find({ key: `org:${IDS.builder}` }))?.text).toContain(`${face.glyph}${face.mark}`)
      expect(await ui.findAll({ type: 'Svg' })).toEqual([])
    }
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

test('where the chart`s Client failed (ui.fault) that surface`s Org lists the agents as a tree and says why; leaving Org, or /deck, tries the Client again; a pane wide enough draws its own chart all the while', async ($, on) => {
  await demo($, on, sampleState())
  const ui = await $.ui.mount(pane('desktop', 24))
  await press(ui, 'tab:org')
  expect((await ui.find({ type: 'Client' }))?.key).toBe('org')
  // a region absurdly wide: the instance fails drawing, and the engine says so (ui.fault)
  await ui.resize({ columns: 200_000, rows: 400, in: 'org' })
  await ui.redraw()
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^The chart could not draw here, so the agents are listed instead\./ })).toBeDefined()
  expect(await keysOf(ui, 'agent:')).toContain(W.agentKeyOf(IDS.builder))
  // widened so it holds the chart, the pane draws its own, Client or none; narrowed again, the tree while Org stays open
  await ui.redraw(pane('desktop').props)
  expect(await ui.find({ key: 'org:chart' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^The chart could not draw here/ })).toBeUndefined()
  await ui.redraw(pane('desktop', 24).props)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ key: 'org:tree' })).toBeDefined()
  // left and come back: the Client again
  await press(ui, 'tab:now')
  await press(ui, 'tab:org')
  expect((await ui.find({ type: 'Client' }))?.key).toBe('org')
  await press(ui, 'tab:now')
  await ui.unmount()
})

test('the Dashboard`s agents head has "Org chart →", which opens Org; Org`s rows for the focus are the chart`s names, none over the Client, the tree`s agents elsewhere', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'now:org' }))?.props).toMatchObject({ label: 'Org chart →', plain: true })
  await press(ui, 'now:org')
  expect((await ui.find({ key: 'tab:org' }))?.props.dimColor).toBe(false)
  expect(await ui.find({ key: 'org:chart' })).toBeDefined()
  await press(ui, 'tab:now')
  await ui.unmount()
  const kit = (client: boolean, svg = false) => ({ surface: 'desktop', columns: 84, ...(client ? { Client: () => null } : {}), ...(svg ? { Svg: () => null } : {}) }) as unknown as Kit
  const tree = treeRowsOf(state).map(({ row }) => W.agentKeyOf(row.id))
  expect(orgFocusKeys(kit(true, true), state, { isDown: false, selected: null })).toEqual(orgLayoutOf(chartAgentsOf(state), 84).cards.map(card => W.agentKeyOf(card.agent.id)))
  expect(orgFocusKeys(kit(true), state, { isDown: false, selected: null })).toEqual([])
  expect(orgFocusKeys(kit(true), state, { isDown: true, selected: null })).toEqual(tree)
  expect(orgFocusKeys(kit(false), state, { isDown: false, selected: null })).toEqual(tree)
})
