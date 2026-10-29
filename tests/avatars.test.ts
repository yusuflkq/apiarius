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

import * as M from '../hooks/model'
import * as D from '../hooks/ui/v2/dashModel'
import { P } from '../hooks/ui/v2/palette'
import * as W from '../hooks/web'
import * as AV from '../web/avatars.mjs'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { NOW, command, deck, lastState, newWorld, work, world } from './world'

function pane<S extends 'terminal' | 'desktop'>(surface: S, bodyColumns = 84) {
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

function sampleState(): W.WebStateV2 {
  const session = v2Session()
  return W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
}

/** The engine with `state` served as the sample and `/deck demo` shown; `store` the plugin's own store, where the deck keeps the person's prefs, when the test reads it back. */
async function demo($: Engine, on: On, state: W.WebStateV2, store?: Map<string, unknown>) {
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
  world(on, newWorld(store ? { store } : {}))
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
  // the finished row opened: those at work, then the finished
  const groups = D.cardAgentsOf(state, true)
  const order = [...groups.shown, ...groups.finished]
  const ui = await $.ui.mount(pane('desktop', 120))
  await press(ui, 'finished:now:fold')
  const svgs = await ui.findAll({ type: 'Svg' })
  const faces = svgs.filter(svg => String(svg.props.alt).endsWith('avatar'))
  // the cards first, in their order: each the library's robot, 22 px, with its status dot, moving as its status does
  for (const [i, row] of order.entries()) {
    expect(faces[i]?.props.alt).toBe(`${row.title}'s avatar`)
    expect(faces[i]?.props.source).toBe(faceOf(row, 22, { dot: true, animated: true }))
    expect(faces[i]?.props).toMatchObject({ width: 22, height: 22 })
    // moving, it is drawn in a frame the Desktop keeps across redraws (an image's motion would start over at each)
    expect(faces[i]?.props.isInteractive).toBe(true)
    expect(String(faces[i]?.props.source)).toContain('@keyframes')
  }
  // a stopped agent looks idle; the Orchestrator is `main`
  const scout = rows.find(row => row.id === IDS.scout)!
  expect(scout.isStopped).toBe(true)
  expect(faces.some(svg => svg.props.source === faceOf(scout, 22, { dot: true, animated: true }))).toBe(true)
  // Recent activity's rows: the agent's face, still, no dot
  const builder = rows.find(row => row.id === IDS.builder)!
  const listed = faces.filter(svg => svg.props.source === faceOf(builder, 20))
  expect(listed.length).toBeGreaterThan(0)
  for (const one of listed) {
    expect(one.props.isInteractive).toBeUndefined()
    expect(String(one.props.source)).not.toContain('<style>')
  }
  // Files: a file's editors as one stacked image of the library's faces
  const file = state.files.find(one => one.editors.length > 1)!
  const editors = file.editors.map(id => rows.find(row => row.id === id)!)
  const stack = AV.avatarStackSvg('robot', editors.map(row => ({ id: row.id, name: row.title, role: row.kind === 'orchestrator' ? 'main' : '', status: row.isStopped ? 'stopped' : row.status, progress: AV.progressOf(row.todos) })), { size: 16, ground: P.ground })
  expect(svgs.filter(svg => svg.props.source === stack).length).toBe(1)
  // the agent's page: 32 px, its dot, its motion
  await press(ui, W.agentKeyOf(IDS.builder))
  const head = (await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === "builder's avatar")
  expect(head?.props.source).toBe(faceOf(builder, 32, { dot: true, animated: true }))
  expect(head?.props.isInteractive).toBe(true)
  await press(ui, 'key:b')
  await ui.unmount()
})

test('the terminal draws no image: each card leads with the agent`s one-character face in the style picked, then its status`s mark in its hue; another style draws at once', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  const shown = D.cardAgentsOf(state).shown
  const cardsSay = async (style: AV.AvatarStyle) => {
    for (const row of shown) {
      const face = AV.terminalFace({ id: row.id, name: row.title, role: row.kind === 'orchestrator' ? 'main' : '', status: row.isStopped ? 'stopped' : row.status, progress: AV.progressOf(row.todos) }, style)
      expect((await ui.find({ key: `card:${row.id}` }))?.text).toContain(`${face.glyph}${face.mark}`)
    }
  }
  await cardsSay('robot')
  const first = (await ui.find({ key: `card:${shown[0]!.id}` }))?.text ?? ''
  expect(AV.ROBOT_GLYPHS.filter(head => first.includes(head))).toHaveLength(1)
  for (const style of ['mono', 'ring', 'glyph'] as const) {
    await $.command.run(deck(`avatars ${style}`))
    await ui.redraw()
    await cardsSay(style)
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

test('the avatar style is the person`s own: read from the store`s prefs as a session starts, /deck avatars <style> keeps another there beside the band`s, and the pane (/deck demo too) draws it at once', async ($, on) => {
  const kept = new Map<string, unknown>([['prefs', { isBandHidden: false, avatarStyle: 'mood' }]])
  const state = sampleState()
  await demo($, on, state, kept)
  const order = D.cardAgentsOf(state).shown
  const ui = await $.ui.mount(pane('desktop'))
  const cardFaces = async () => (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).endsWith('avatar')).slice(0, order.length).map(svg => svg.props.source)
  expect(await cardFaces()).toEqual(order.map(row => faceOf(row, 22, { dot: true, animated: true }, 'mood')))
  // /deck avatars lists the ten, the one drawn marked
  const listed = await $.command.run(deck('avatars'))
  expect(listed.text).toContain('Avatar styles (now Mood faces)')
  expect(listed.text).toContain('▸ mood     Mood faces')
  expect(listed.text).toContain('  critter  Critters')
  // a style by the start of its name: kept beside the band's, and drawn
  const set = await $.command.run(deck('avatars Crit'))
  expect(set.text).toContain('Avatars: Critters')
  expect(kept.get('prefs')).toEqual({ isBandHidden: false, avatarStyle: 'critter' })
  await ui.redraw()
  expect(await cardFaces()).toEqual(order.map(row => faceOf(row, 22, { dot: true, animated: true }, 'critter')))
  // by its name too; one it does not know changes nothing
  expect((await $.command.run(deck('avatars pixel sprites'))).text).toContain('Avatars: Pixel sprites')
  expect((await $.command.run(deck('avatars plaid'))).text).toContain('No avatar style called "plaid"')
  expect(kept.get('prefs')).toEqual({ isBandHidden: false, avatarStyle: 'pixel' })
  // the band's toggle keeps the style it found
  await $.command.run(deck('band'))
  expect(kept.get('prefs')).toEqual({ isBandHidden: true, avatarStyle: 'pixel' })
  await ui.unmount()
})

test('Settings` avatar style: the ten, each its name beside the page`s three sample agents drawn in it (done, at work, waiting on you, each with its dot), the one drawn marked; a press draws that one, kept as /deck avatars keeps one', async ($, on) => {
  const kept = new Map<string, unknown>()
  await demo($, on, sampleState(), kept)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:settings')
    const picks = (await ui.findAll({ type: 'Button' })).filter(one => /^avatars:[a-z]+$/.test(one.key ?? ''))
    expect(picks.map(one => [one.key, one.props.label])).toEqual(AV.STYLES.map(one => [`avatars:${one.id}`, one.name]))
    expect((await ui.find({ key: 'avatars:robot' }))?.props).toMatchObject({ label: 'Robots', plain: true, dimColor: false })
    expect((await ui.find({ key: 'avatars:mood' }))?.props.dimColor).toBe(true)
    await press(ui, 'avatars:mood')
    expect(kept.get('prefs')).toEqual({ isBandHidden: false, avatarStyle: 'mood' })
    expect((await ui.find({ key: 'avatars:mood' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ key: 'avatars:robot' }))?.props.dimColor).toBe(true)
    // the page's three (web/app.js WELCOME), as its Settings draws them: the same library call, the same seeds, their status dots
    const three = [
      { id: 'bob', name: 'bob', role: '', status: 'done' },
      { id: 'helper', name: 'helper', role: '', status: 'running' },
      { id: 'deck-1', name: 'deck', role: '', status: 'waiting' },
    ]
    if (surface === 'desktop') {
      // each style's three, drawn in it, still, each with its dot
      const faces = (await ui.findAll({ type: 'Svg' })).filter(svg => / drawn in it$/.test(String(svg.props.alt)))
      expect(faces.map(svg => svg.props.source)).toEqual(AV.STYLE_IDS.flatMap(id => three.map(one => AV.avatarSvg(id, one, { size: 24, dot: true, ground: P.ground }))))
      expect(faces.slice(0, 3).map(svg => svg.props.alt)).toEqual(['Robots: bob drawn in it', 'Robots: helper drawn in it', 'Robots: deck drawn in it'])
      expect(faces.every(svg => svg.props.isInteractive === undefined)).toBe(true)
      // the one drawn is ringed and ticked
      expect((await ui.find({ key: 'avatars:chip:mood' }))?.text).toContain('✓')
      expect((await ui.find({ key: 'avatars:chip:robot' }))?.text).not.toContain('✓')
    } else {
      expect(await ui.findAll({ type: 'Svg' })).toEqual([])
      expect((await ui.find({ key: 'avatars:chip:mood' }))?.text).toContain('◉')
      expect((await ui.find({ key: 'avatars:chip:robot' }))?.text).toContain('○')
      // the three where they fit: each one character and its status's mark
      const marks = three.map(one => AV.terminalFace(one, 'robot'))
      expect((await ui.find({ key: 'avatars:chip:robot' }))?.text).toContain(marks.map(face => `${face.glyph}${face.mark}`).join(''))
    }
    await press(ui, 'avatars:robot')
    expect(kept.get('prefs')).toEqual({ isBandHidden: false, avatarStyle: 'robot' })
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('the web page`s avatarStyle command: a style the deck knows is kept as the person`s, named in the next state.json (v2 `avatarStyle`) with its ack; one it does not know is refused and changes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kept = new Map<string, unknown>()
  const w = newWorld({ store: kept })
  world(on, w)
  await work($)
  await clock.advance(1000)
  const v2 = () => (lastState(w) as unknown as { v2: W.WebStateV2 }).v2
  expect(v2().avatarStyle).toBe('robot')
  command(w.children[0], { cmd: 'avatarStyle', id: 'av-1', style: 'pixel' })
  await clock.settle()
  await clock.advance(1000)
  expect(v2().avatarStyle).toBe('pixel')
  expect(v2().acks.find(one => one.id === 'av-1')).toMatchObject({ ok: true, status: 'delivered', text: 'Avatars: Pixel sprites' })
  expect(kept.get('prefs')).toEqual({ isBandHidden: false, avatarStyle: 'pixel' })
  command(w.children[0], { cmd: 'avatarStyle', id: 'av-2', style: 'plaid' })
  await clock.settle()
  await clock.advance(1000)
  expect(v2().avatarStyle).toBe('pixel')
  expect(v2().acks.find(one => one.id === 'av-2')).toMatchObject({ ok: false, status: 'failed', text: 'Not an avatar style the deck knows: plaid' })
  // the route the mod reads it by
  expect(W.routeOf({ cmd: 'avatarStyle', style: 'glyph' }, M.emptyData(0))).toEqual({ kind: 'avatarStyle', style: 'glyph' })
  expect(W.routeOf({ cmd: 'avatarStyle', style: 'Glyph' }, M.emptyData(0))).toBeNull()
  expect(W.refusalOf({ cmd: 'avatarStyle', style: 7 }, M.emptyData(0))).toBe('Not an avatar style the deck knows: 7')
})

test('the state names the style (deckStateOf`s last argument; robots by default, an unknown one robots), and a view healed from an older snapshot draws robots', () => {
  const session = v2Session()
  const state = (style?: string) => W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable, new Map(), style)
  expect(state().avatarStyle).toBe('robot')
  expect(state('orbit').avatarStyle).toBe('orbit')
  expect(state('plaid').avatarStyle).toBe('robot')
  expect(Object.keys(state()).slice(0, 4)).toEqual(['v', 'now', 'session', 'avatarStyle'])
  expect(M.healView({ tab: 'now' }).avatarStyle).toBe('robot')
  expect(M.healView({ avatarStyle: 'blob' }).avatarStyle).toBe('blob')
  expect(M.healView({ avatarStyle: 'plaid' }).avatarStyle).toBe('robot')
})
