/**
 * The deck's pane on the v2 view model, on the terminal and the desktop:
 * the header, the tabs and every key as a Button's hotkey; Now (Needs you,
 * the agents' tree with its folds, the plan from every source Claude used);
 * an agent's page and Back; Chat (its sentence rows, its filters, `f`, its
 * window, the composer and what came of a send); Changes; Inspect and help;
 * and the band's one line. Drawn by the deck itself (`/deck demo` over the
 * v2 sample, `/deck` over a live session), or a piece by itself (`probe`).
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as M from '../hooks/model'

import * as W from '../hooks/web'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { deck, newWorld, NOW, work, world, type World } from './world'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane<S extends Surface>(surface: S, bodyColumns = 84, requestId = 'agent-deck') {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId,
    viewport: { columns: bodyColumns + 4, rows: 60, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }
}

type Drawing = { press: (target: { key: string }) => Promise<unknown>; redraw: () => Promise<void> }

/** A press, then the drawing as the pane draws it next. */
async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

/** The v2 sample as `/deck demo` reads it: the sample session's state and its agent files, patches and cut messages. */
function sample(on: On) {
  const session = v2Session()
  const v2 = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const v1 = W.webStateOf(session.data, M.defaultView(), session.git, session.usage, session.now, session.sessionId, session.cwd)
  const agentFiles = new Map(W.agentFilesOf(session.data).map(one => [one.id, one.text]))
  const patches = new Map(session.data.edits.map(edit => [W.webIdOf(edit.id), edit.patch]))
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.json')) return { value: JSON.stringify(v1) }
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(v2) }
    const agent = /\/web\/fixtures\/v2\/agents\/([^/]+)\.json$/.exec(path)?.[1]
    if (agent && agentFiles.has(agent)) return { value: agentFiles.get(agent)! }
    const patch = /\/web\/fixtures\/v2\/patches\/([^/]+)\.diff$/.exec(path)?.[1]
    if (patch && patches.has(patch)) return { value: patches.get(patch)! }
    if (/\/web\/fixtures\/v2\/messages\//.test(path)) return { value: 'The whole answer.\n\n- **researcher** mapped the routes.\n' }
    return { deny: 'no such file' }
  })
  return v2
}

/** The engine, the v2 sample read, and `/deck demo` shown. */
async function demo($: Engine, on: On, w: World = newWorld()) {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const v2 = sample(on)
  on('ui.focus', () => ({}))
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  return { clock, v2, w }
}

/** The Button keys a drawing holds, in document order, that start with `prefix`. */
async function keysOf(ui: { findAll: (q: { type: 'Button' }) => Promise<{ key?: string }[]> }, prefix: string): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith(prefix))
}

test('Now: the header says the state, your request and model · context · $; the tabs and every key are Buttons with one-character hotkeys', async ($, on) => {
  const { v2 } = await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const header = await ui.find({ key: 'deck:header' })
    expect(header?.text).toContain('Waiting on you')
    expect(header?.text).toContain('Also exempt /health and /metrics from the limiter.')
    expect(header?.text).toContain(v2.header.line)
    expect(v2.header.line).toBe('opus-5.5 · context 41% · $4.12')
    // the tabs: 1 Now · 2 Chat · 3 Changes, Now lit; Changes counts git's files
    expect((await ui.find({ key: 'tab:now' }))?.props).toMatchObject({ label: 'Now', hotkey: '1', plain: true, dimColor: false })
    expect((await ui.find({ key: 'tab:chat' }))?.props).toMatchObject({ label: 'Chat', hotkey: '2', dimColor: true })
    expect((await ui.find({ key: 'tab:changes' }))?.props).toMatchObject({ label: `Changes ${v2.changes.files.length}`, hotkey: '3' })
    // every key a plain Button with its hotkey: n i h in the header, m j k beside the tabs
    const hotkeys = Object.fromEntries((await ui.findAll({ type: 'Button' })).filter(one => one.props.hotkey !== undefined).map(one => [one.props.hotkey, one.key]))
    expect(hotkeys).toEqual({ '1': 'tab:now', '2': 'tab:chat', '3': 'tab:changes', n: 'key:n', i: 'key:i', h: 'key:h', m: 'key:m', j: 'key:j', k: 'key:k' })
    for (const key of Object.keys(hotkeys)) expect(key).toMatch(/^[0-9a-z]$/)
    // no KPI strip, no cards of agents: the old Dashboard is gone
    expect(await ui.find({ key: 'kpi:running' })).toBeUndefined()
    await ui.unmount()
  }
})

test('Now: Needs you as Claude Code holds them (a question answerable here, a permission with its command, a notification verbatim, each its age), the tree of who started whom with its folds, the plan from every source', async ($, on) => {
  const { v2 } = await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // each need's title a Button keyed as `j`, `k` and `n` move to (W.needKeyOf), in the state's order
    expect(await keysOf(ui, 'need:')).toEqual(v2.needs.map(need => W.needKeyOf(need.id)))
    const ask = await ui.find({ key: 'needs:toolu_01AskOne' })
    expect(ask?.text).toContain('Orchestrator asks you')
    expect(ask?.text).toContain('Which store should back the limiter in production?')
    expect(ask?.text).toContain('3m')
    expect((await ui.find({ key: 'answer:toolu_01AskOne:0:0' }))?.props.label).toBe('Redis')
    expect(await ui.find({ key: 'other:toolu_01AskOne:0' })).toBeDefined()
    // a multi-select one toggles and sends with Submit
    expect((await ui.find({ key: 'answer:toolu_01AskMany:0:1' }))?.props.label).toBe('☐ /metrics')
    expect((await ui.find({ key: 'answer:toolu_01AskMany' }))?.props.label).toBe('Submit')
    // a permission: its tool, its exact command, what it does, and where to answer it
    const permit = await ui.find({ key: 'needs:toolu_01BldB2' })
    expect(permit?.text).toContain('builder needs your OK · Bash')
    expect((await ui.find({ type: 'Code', text: 'npm test -- rateLimit' })) ?? null).not.toBeNull()
    expect(permit?.text).toContain('Run the limiter tests')
    expect(permit?.text).toContain('Answer it in Claude Code.')
    // Claude Code's notification, as it sent it
    const note = v2.needs.find(need => need.kind === 'notification')!
    expect((await ui.find({ key: `needs:${note.id}` }))?.text).toContain('The github MCP server is asking for your input')

    // the tree: a row an agent, indented by its depth; the fold rows folded, their members not drawn
    expect(await keysOf(ui, 'agent:')).toEqual(['agent:main', `agent:${IDS.builder}`, `agent:${IDS.reviewer}`])
    expect(await keysOf(ui, 'fold:')).toEqual([`fold:${IDS.builder}`, 'fold:main'])
    expect((await ui.find({ key: 'fold:main' }))?.props.label).toBe('▸ 2 done · 1 stopped')
    const builder = await ui.find({ key: `row:${IDS.builder}` })
    expect(builder?.props.paddingLeft).toBe(2)
    expect(builder?.text).toContain('Bash npm test -- rateLimit')
    expect(builder?.text).toContain('29m')
    // avatars: the gradient face with its status dot where Svg draws; the status dot alone on the terminal
    const faces = (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).endsWith('avatar'))
    if (surface === 'desktop') expect(faces.map(face => face.props.alt)).toEqual(["Orchestrator's avatar", "builder's avatar", "reviewer's avatar"])
    else expect(faces).toEqual([])

    // the plan: the board, the Orchestrator's own list, the approved plan folded to its first line, the Workflow's phases
    const plan = await ui.find({ key: 'now:plan' })
    expect(plan?.text).toContain('Task board')
    expect(plan?.text).toContain('Writing the limiter')
    expect(plan?.text).toContain('Orchestrator’s todos')
    expect(plan?.text).toContain('Rate limiting for the public API')
    expect(plan?.text).toContain('Lint → Unit tests → Package')
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await press(ui, 'plan:approved')
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain('1. **Map the routes.**')
    await press(ui, 'plan:approved')
    await ui.unmount()
  }
})

test('a fold row opens its members (and they stay open), an agent`s row opens its page, and b goes back', async ($, on) => {
  await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'fold:main')
    expect((await ui.find({ key: 'fold:main' }))?.props.label).toBe('▾ 2 done · 1 stopped')
    expect(await keysOf(ui, 'agent:')).toEqual(['agent:main', `agent:${IDS.builder}`, `agent:${IDS.reviewer}`, `agent:${IDS.researcher}`, `agent:${IDS.docs}`, `agent:${IDS.scout}`])
    expect((await ui.find({ key: `row:${IDS.scout}` }))?.text).toContain('stopped')
    await press(ui, 'fold:main')
    expect(await ui.find({ key: `agent:${IDS.scout}` })).toBeUndefined()

    // builder's page: who it is, its live call, what it waits on you for, its task; Activity and Edits on demand
    await press(ui, `agent:${IDS.builder}`)
    expect((await ui.find({ key: 'key:b' }))?.props).toMatchObject({ hotkey: 'b', label: '← Back' })
    const head = await ui.find({ key: 'page:head' })
    expect(head?.text).toContain('builder')
    expect(head?.text).toContain('started by')
    expect((await ui.find({ key: 'page:live' }))?.text).toContain('Bash npm test -- rateLimit')
    expect(await keysOf(ui, 'need:')).toEqual(['need:toolu_01BldB2'])
    expect((await ui.find({ key: 'page:task' }))?.text).toContain('Write a sliding-window rate limiter')
    expect((await ui.find({ key: 'page:fold:activity' }))?.props.label).toMatch(/^▸ ACTIVITY \d+$/)
    await press(ui, 'page:fold:activity')
    expect((await ui.find({ key: 'page:activity' }))?.text).toContain('Edit')
    await press(ui, 'page:fold:edits')
    expect((await ui.findAll({ type: 'Code' })).some(code => code.props.format === 'diff')).toBe(true)
    await press(ui, 'page:fold:activity')
    await press(ui, 'page:fold:edits')
    // its parent's name opens the Orchestrator's page; b comes back to Now
    await press(ui, 'page:parent:main')
    expect((await ui.find({ key: 'page:head' }))?.text).toContain('Orchestrator')
    await press(ui, 'key:b')
    expect(await ui.find({ key: 'page:head' })).toBeUndefined()
    expect(await ui.find({ key: 'now:agents' })).toBeDefined()
    await ui.unmount()
  }
})

test('Chat: every message as a sentence row with its time, f and the chips filter it, a long one folds and opens in place, a send from the deck says what came of it', async ($, on) => {
  const { v2 } = await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:chat')
    expect((await ui.find({ key: 'tab:chat' }))?.props.dimColor).toBe(false)
    // a row a message, oldest first, read as a sentence
    const rows = (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('msg:'))
    expect(rows).toEqual(v2.chat.map(row => `msg:${row.id}`))
    const between = v2.chat.find(row => row.kind === 'message' && row.title === 'Limiter ready for review')!
    const said = await ui.find({ key: `msg:${between.id}` })
    expect(said?.text).toContain('builder → reviewer:')
    expect(said?.text).toContain('Limiter ready for review')
    // no addressee made up: builder's words to nobody in particular read "builder:"
    const plain = v2.chat.find(row => row.to === null)!
    expect((await ui.find({ key: `msg:${plain.id}` }))?.text).toContain('builder: Will do')
    // what came of the deck's sends
    const failed = v2.chat.find(row => row.ackId === 'c-1')!
    expect((await ui.find({ key: `msg:${failed.id}` }))?.text).toContain('✕ Not delivered: it has ended')
    const delivered = v2.chat.find(row => row.ackId === 'c-2')!
    expect((await ui.find({ key: `msg:${delivered.id}` }))?.text).toContain('✓ Delivered: it reads it at its next step')
    // a question still held on you says so
    const asked = v2.chat.find(row => row.kind === 'question' && row.callId === 'toolu_01AskOne')!
    expect((await ui.find({ key: `msg:${asked.id}` }))?.text).toContain('waiting on you')

    // the cut answer: folded, Show more reads its whole text and opens it as Markdown
    const cut = v2.chat.find(row => row.isCut)!
    expect(await ui.find({ key: `chat:more:${cut.id}` })).toBeDefined()
    await press(ui, `chat:more:${cut.id}`)
    expect((await ui.find({ type: 'Markdown', text: /The whole answer/ })) ?? null).not.toBeNull()
    expect((await ui.find({ key: `chat:more:${cut.id}` }))?.props.label).toBe('Show less')
    await press(ui, `chat:more:${cut.id}`)

    // the chips: All · You · each agent the chat names · Between agents; f steps to the next
    const chips = await keysOf(ui, 'chat:filter:')
    expect(chips[0]).toBe('chat:filter:all')
    expect(chips[1]).toBe('chat:filter:you')
    expect(chips).toContain(`chat:filter:${IDS.builder}`)
    expect(chips[chips.length - 1]).toBe('chat:filter:between')
    expect((await ui.find({ key: 'key:f' }))?.props).toMatchObject({ hotkey: 'f', label: 'Filter' })
    await press(ui, 'key:f')
    expect((await ui.find({ key: 'chat:filter:you' }))?.props.dimColor).toBe(false)
    const mine = (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('msg:'))
    expect(mine).toEqual(v2.chat.filter(row => row.from === 'you' || row.to === 'you').map(row => `msg:${row.id}`))
    await press(ui, 'chat:filter:between')
    const theirs = (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('msg:'))
    expect(theirs).toContain(`msg:${between.id}`)
    expect(theirs).not.toContain(`msg:${delivered.id}`)
    await press(ui, `chat:filter:${IDS.builder}`)
    const builders = v2.chat.filter(row => row.from === IDS.builder || row.to === IDS.builder || row.agent === IDS.builder)
    expect((await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('msg:'))).toEqual(builders.map(row => `msg:${row.id}`))
    await press(ui, 'chat:filter:all')
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('the composer: no @ goes to the Orchestrator, @name to that agent by SendMessage (previewed so), a name no agent carries is refused before it goes; the send shows at once and what came of it under it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  on('ui.focus', () => ({}))
  world(on, w)
  await work($)
  await $.command.run(deck('chat'))
  await clock.advance(1000)
  const field = async (ui: { find: (q: { type: 'Input' }) => Promise<{ key?: string } | undefined> }) => (await ui.find({ type: 'Input' }))?.key ?? ''
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'tab:chat' }))?.props.dimColor).toBe(false)
    await ui.input({ key: await field(ui), text: '', kind: 'change' })
    await ui.redraw()
    expect((await ui.find({ key: 'chat:compose' }))?.text).toContain('No @: to the Orchestrator')
    // a name no agent carries: refused, said why, nothing sent
    await ui.input({ key: await field(ui), text: '@nobody look again' })
    await ui.redraw()
    expect((await ui.find({ key: 'chat:compose' }))?.text).toContain('No agent named @nobody in this session')
    expect(w.sent).toEqual([])
    // the preview says where the words go while they are typed
    await ui.input({ key: await field(ui), text: '@scout look', kind: 'change' })
    await ui.redraw()
    expect((await ui.find({ key: 'chat:compose' }))?.text).toContain('→ scout via SendMessage')
    await ui.input({ key: await field(ui), text: 'hello', kind: 'change' })
    await ui.redraw()
    expect((await ui.find({ key: 'chat:compose' }))?.text).toContain('→ Orchestrator')
    await ui.unmount()
  }
  const ui = await $.ui.mount(pane('desktop'))
  const before = await field(ui)
  await ui.input({ key: before, text: '@scout look at src/range.js again' })
  await clock.advance(400)
  await ui.redraw()
  expect(w.sent).toEqual([{ to: 'agent-x1', text: 'look at src/range.js again' }])
  // the row is the state's now, with what came of it; the field starts empty again
  const row = (await ui.findAll({ type: 'Box' })).find(box => (box.key ?? '').startsWith('msg:') && box.text.includes('look at src/range.js again'))
  expect(row?.text).toContain('You → scout:')
  expect(row?.text).toContain('Delivered')
  expect(await field(ui)).not.toBe(before)
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('')
  await ui.unmount()
})

test('a question answered from the pane: one press for one answer, toggles and Submit for several; it goes the way the page`s answer goes (in the sample, there alone)', async ($, on) => {
  const { w } = await demo($, on)
  const ui = await $.ui.mount(pane('desktop'))
  await press(ui, 'answer:toolu_01AskOne:0:0')
  expect(w.toasts).toContain('Sample data: you answered Redis. Nothing was sent to Claude.')
  expect(await ui.find({ key: 'need:toolu_01AskOne' })).toBeUndefined()
  // several: each press toggles, Submit sends them; Submit with none picked says so
  await press(ui, 'answer:toolu_01AskMany')
  expect((await ui.find({ key: 'needs:toolu_01AskMany' }))?.text).toContain('Pick an answer for Exempt first.')
  await press(ui, 'answer:toolu_01AskMany:0:0')
  await press(ui, 'answer:toolu_01AskMany:0:1')
  expect((await ui.find({ key: 'answer:toolu_01AskMany:0:0' }))?.props.label).toBe('☑ /health')
  await press(ui, 'answer:toolu_01AskMany')
  expect(w.toasts).toContain('Sample data: you answered /health, /metrics. Nothing was sent to Claude.')
  expect(await ui.find({ key: 'need:toolu_01AskMany' })).toBeUndefined()
  // Chat says how each was answered
  await press(ui, 'tab:chat')
  const chat = (await ui.findAll({ type: 'Box' })).filter(box => (box.key ?? '').startsWith('msg:')).map(box => box.text)
  expect(chat.some(text => text.includes('You answered: Redis'))).toBe(true)
  await press(ui, 'tab:now')
  await ui.unmount()
})

test('Changes: git`s files as Buttons keyed file:<path>, one opened with the agents` own edits of it; the edits outside the repository; the commits', async ($, on) => {
  const { v2 } = await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 84))
    await press(ui, 'tab:changes')
    expect((await ui.find({ key: 'changes:repo' }))?.text).toContain('acme-api ⎇ feat/rate-limit')
    expect(await keysOf(ui, 'file:')).toEqual(v2.changes.files.map(file => W.fileKeyOf(file.path)))
    expect((await ui.find({ key: 'filerow:src/app.ts' }))?.text).toContain('builder')
    await press(ui, 'file:src/app.ts')
    const open = await ui.find({ key: 'filediff:src/app.ts' })
    expect(open?.text).toContain('Edit by builder')
    expect(open?.text).toContain('The sample holds no git diff of its own')
    expect((await ui.findAll({ type: 'Code' })).some(code => code.props.format === 'diff' && String(code.props.source).includes('rateLimit'))).toBe(true)
    // the sample sends no review prompt: Review is this session's
    expect(await ui.find({ key: 'changes:review' })).toBeUndefined()
    expect(await keysOf(ui, 'edits:')).toEqual(['edits:toolu_01BldW2'])
    expect(await keysOf(ui, 'commit:')).toEqual([`commit:${v2.changes.commits[0]?.hash}`])
    await press(ui, 'file:src/app.ts')
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('i opens Inspect (the context, the spend, each agent`s tokens), h the keys; b, or the key again, closes each; m on an agent`s page opens Chat filtered to it with @ it in the composer', async ($, on) => {
  await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'key:i')
    const inspect = await ui.find({ key: 'inspect' })
    expect(inspect?.text).toContain('context 41% · $4.12 spent')
    expect((await ui.find({ key: `inspect:${IDS.builder}` }))?.text).toContain('sonnet-4.5 · 96k in · 14.8k out · 402k cache · 18 requests · 4 tools')
    await press(ui, 'key:b')
    expect(await ui.find({ key: 'inspect' })).toBeUndefined()
    await press(ui, 'key:h')
    expect((await ui.find({ key: 'help' }))?.text).toContain('filter Chat: All · You · each agent · Between agents')
    await press(ui, 'key:h')
    expect(await ui.find({ key: 'help' })).toBeUndefined()

    await press(ui, `agent:${IDS.builder}`)
    await press(ui, 'key:m')
    expect((await ui.find({ key: 'tab:chat' }))?.props.dimColor).toBe(false)
    expect(await ui.find({ key: 'page:head' })).toBeUndefined()
    expect((await ui.find({ key: `chat:filter:${IDS.builder}` }))?.props.dimColor).toBe(false)
    expect((await ui.find({ type: 'Input' }))?.props.value).toBe('@builder ')
    await press(ui, 'chat:filter:all')
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('the band: one line while an agent is at work or something needs you, its words the state`s, and /deck opens Now', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  await clock.advance(1000)
  const BAND = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'agent-deck', surface, component: 'AbovePrompt', props: BAND })
    expect(JSON.stringify(await ui.drawn())).toContain('1 working')
    expect((await ui.find({ key: 'band:open' }))?.props).toMatchObject({ label: '/deck', plain: true })
    expect((await ui.find({ key: 'band:open' }))?.props.hotkey).toBeUndefined()
    await ui.unmount()
  }
  await $.command.run(deck('chat'))
  const band = await $.ui.mount({ plugin: 'agent-deck', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'band:open' })
  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ key: 'tab:now' }))?.props.dimColor).toBe(false)
  await ui.unmount()
  await band.unmount()
})

/** The nodes a drawn tree holds. */
function nodesOf(node: unknown): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node !== 'object') return 1
  const children = (node as { children?: unknown[] }).children ?? []
  return 1 + children.reduce((sum: number, child) => sum + nodesOf(child), 0)
}

test('Chat draws a window of the newest rows, Show earlier adds more, and even the whole of the state`s 200 keeps inside the pane`s bounds', async ($, on) => {
  const data = M.emptyData(NOW - 7_200_000)
  for (let i = 0; i < 260; i++) M.addMessage(data, { from: i % 2 ? M.YOU : M.MAIN, to: i % 2 ? M.MAIN : M.YOU, kind: i % 2 ? 'prompt' : 'answer', text: `Message ${i}: ${'words '.repeat(80)}`, at: NOW - (260 - i) * 10_000 })
  const view = { ...M.defaultView(), v2: { ...M.defaultView2(), tab: 'chat' as const } }
  const clock = mock.clock(on, { now: NOW })
  world(on, newWorld(), { v: M.SNAPSHOT_VERSION, data, view })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('chat'))
  await clock.advance(1000)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // what opening the pane started (git, the usage) draws again once it is read
    await clock.advance(1000)
    await ui.redraw()
    const rows = async () => (await ui.findAll({ type: 'Box' })).filter(box => (box.key ?? '').startsWith('msg:')).length
    // the window is the pane's own, the same on every surface it draws on: paged on the first
    if (surface === SURFACES[0]) {
      expect(await rows()).toBe(30)
      expect((await ui.find({ key: 'chat:earlier' }))?.props.label).toBe('Show earlier · 170 more')
      await press(ui, 'chat:earlier')
      expect(await rows()).toBe(60)
    }
    for (let i = 0; i < 5 && (await ui.find({ key: 'chat:earlier' })); i++) await press(ui, 'chat:earlier')
    // as many as the pane holds, the newest; then it says where the rest are
    const shown = await rows()
    expect(shown).toBeGreaterThan(60)
    expect(await ui.find({ key: 'chat:earlier' })).toBeUndefined()
    expect((await ui.find({ key: 'chat' }))?.text).toContain(`${200 - shown} earlier: more than the pane holds.`)
    expect(nodesOf(await ui.drawn())).toBeLessThan(2000)
    expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(200_000)
    await ui.unmount()
  }
})
