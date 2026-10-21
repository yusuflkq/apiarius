/**
 * The agents' avatars on the pane, from the deck's one avatar library
 * (web/avatars.mjs), the very documents the web page shows: on a desktop
 * each face an image of the library's SVG in the deck's style (robots by
 * default), its status dot at its foot and its status's motion where it
 * stands for an agent (a card, Org's tree, the agent's page), still in a
 * list and a stack; on the terminal the agent's glyph in its colour and its
 * status's mark.
 *
 * Drawn by `/deck demo` over the v2 sample (tests/v2session.ts).
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as D from '../hooks/ui/v2/dashModel'
import { P } from '../hooks/ui/v2/palette'
import * as W from '../hooks/web'
import * as AV from '../web/avatars.mjs'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { deck, newWorld, world } from './world'

function pane<S extends 'terminal' | 'desktop'>(surface: S, bodyColumns = 84) {
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

function sampleState(): W.WebStateV2 {
  const session = v2Session()
  return W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
}

/** The engine with `state` served as the sample and `/deck demo` shown. */
async function demo($: Engine, on: On, state: W.WebStateV2) {
  const session = v2Session()
  const agentFiles = new Map(W.agentFilesOf(session.data).map(one => [one.id, one.text]))
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(state) }
    const agent = /\/web\/fixtures\/v2\/agents\/([^/]+)\.json$/.exec(path)?.[1]
    if (agent && agentFiles.has(agent)) return { value: agentFiles.get(agent)! }
    return { deny: 'no such file' }
  })
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  on('ui.focus', () => ({}))
  world(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
}

/** The library's document for `row` as the pane draws it. */
function faceOf(row: W.V2AgentRow, size: number, opts: { dot?: boolean; animated?: boolean } = {}, style = 'robot'): string {
  const agent = { id: row.id, name: row.title, role: row.kind === 'orchestrator' ? 'main' : '', status: row.isStopped ? 'stopped' : row.status, progress: AV.progressOf(row.todos) }
  return AV.avatarSvg(style, agent, { size, dot: opts.dot === true, animated: opts.animated === true, ground: P.ground })
}

test('a desktop draws each agent`s face as the library`s own document, robots by default: a card`s and the agent page`s with their status dot and motion, a list row`s still, the editors` one stacked image', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  const rows = D.agentRowsOf(state)
  const order = D.cardAgentsOf(state).shown
  const ui = await $.ui.mount(pane('desktop', 120))
  const svgs = await ui.findAll({ type: 'Svg' })
  const faces = svgs.filter(svg => String(svg.props.alt).endsWith('avatar'))
  // the cards first, in their order: each the library's robot, 22 px, with its status dot, moving as its status does
  for (const [i, row] of order.entries()) {
    expect(faces[i]?.props.alt).toBe(`${row.title}'s avatar`)
    expect(faces[i]?.props.source).toBe(faceOf(row, 22, { dot: true, animated: true }))
    expect(faces[i]?.props).toMatchObject({ width: 22, height: 22 })
  }
  // a stopped agent looks idle; the Orchestrator is `main`
  const scout = rows.find(row => row.id === IDS.scout)!
  expect(scout.isStopped).toBe(true)
  expect(faces.some(svg => svg.props.source === faceOf(scout, 22, { dot: true, animated: true }))).toBe(true)
  // Recent activity's rows: the agent's face, still, no dot
  const builder = rows.find(row => row.id === IDS.builder)!
  expect(faces.some(svg => svg.props.source === faceOf(builder, 20))).toBe(true)
  // Files: a file's editors as one stacked image of the library's faces
  const file = state.files.find(one => one.editors.length > 1)!
  const editors = file.editors.map(id => rows.find(row => row.id === id)!)
  const stack = AV.avatarStackSvg('robot', editors.map(row => ({ id: row.id, name: row.title, role: row.kind === 'orchestrator' ? 'main' : '', status: row.isStopped ? 'stopped' : row.status, progress: AV.progressOf(row.todos) })), { size: 16, ground: P.ground })
  expect(svgs.filter(svg => svg.props.source === stack).length).toBe(1)
  // the agent's page: 32 px, its dot, its motion
  await press(ui, W.agentKeyOf(IDS.builder))
  const head = (await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === "builder's avatar")
  expect(head?.props.source).toBe(faceOf(builder, 32, { dot: true, animated: true }))
  await press(ui, 'key:b')
  await ui.unmount()
})

test('the terminal draws no image: each card leads with the agent`s glyph in its colour, then its status`s mark in its hue', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  for (const row of D.cardAgentsOf(state).shown) {
    const face = AV.terminalFace({ id: row.id, status: row.isStopped ? 'stopped' : row.status })
    const card = await ui.find({ key: `card:${row.id}` })
    expect(card?.text).toContain(`${face.glyph}${face.mark}`)
    expect(AV.GLYPHS).toContain(face.glyph)
  }
  const builder = AV.terminalFace({ id: IDS.builder, status: 'waiting' })
  expect(builder.mark).toBe('‖')
  expect(builder.markColor).toBe(AV.LOOK_HUE.waiting)
  await ui.unmount()
})

test('the state`s avatar index is the library`s palette index: the same id, the same colours, on every surface', () => {
  for (const row of D.agentRowsOf(sampleState())) {
    expect(row.avatar).toBe(AV.paletteIndexOf({ id: row.id }))
    expect(W.avatarOf(row.id)).toBe(row.avatar)
  }
})
