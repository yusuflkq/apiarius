/**
 * The deck's pane on the v2 view model, on the terminal and the desktop:
 * the header, the tabs and every key as a Button's hotkey; Now (Needs you,
 * the agents' cards, the figures, the plan from every source Claude used,
 * Recent activity and Files, each section folding by its head; more of it
 * in tests/now.test.ts);
 * an agent's page and Back; Changes; Inspect and help; and the band's one
 * line (Chat's own tests are in tests/chat.test.ts). Drawn by the deck
 * itself (`/deck demo` over the v2 sample, `/deck` over a live session),
 * or a piece by itself (`probe`).
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
    viewport: { columns: bodyColumns + 4, rows: 400, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} },
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

test('the Dashboard: the header says the state, your request and model · context · $, and holds no keys; the tabs are Buttons with their digits as hotkeys, and nothing else has one', async ($, on) => {
  const { v2 } = await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const header = await ui.find({ key: 'deck:header' })
    expect(header?.text).toContain('Waiting on you')
    expect(header?.text).toContain('Also exempt /health and /metrics from the limiter.')
    expect(header?.text).toContain(v2.header.line)
    expect(v2.header.line).toBe('opus-5.5 · context 41% · $4.12')
    // the tabs: 1 Dashboard · 2 Chat · 3 Org · 4 Changes · 5 Settings, the Dashboard (`now`) lit; Changes counts git's files
    expect((await ui.find({ key: 'tab:now' }))?.props).toMatchObject({ label: 'Dashboard', hotkey: '1', plain: true, dimColor: false })
    expect((await ui.find({ key: 'tab:chat' }))?.props).toMatchObject({ label: 'Chat', hotkey: '2', dimColor: true })
    expect((await ui.find({ key: 'tab:org' }))?.props).toMatchObject({ label: 'Org', hotkey: '3', dimColor: true })
    expect((await ui.find({ key: 'tab:changes' }))?.props).toMatchObject({ label: `Changes ${v2.changes.files.length}`, hotkey: '4' })
    expect((await ui.find({ key: 'tab:settings' }))?.props).toMatchObject({ label: 'Settings', hotkey: '5', dimColor: true })
    // the tabs alone have hotkeys: no Message, ↓, ↑, Inspect, Help or Next need
    const hotkeys = Object.fromEntries((await ui.findAll({ type: 'Button' })).filter(one => one.props.hotkey !== undefined).map(one => [one.props.hotkey, one.key]))
    expect(hotkeys).toEqual({ '1': 'tab:now', '2': 'tab:chat', '3': 'tab:org', '4': 'tab:changes', '5': 'tab:settings' })
    for (const key of ['key:n', 'key:i', 'key:h', 'key:m', 'key:j', 'key:k']) expect(await ui.find({ key })).toBeUndefined()
    expect(header?.text ?? '').not.toMatch(/Inspect|Help|Next need/)
    // the Dashboard: a card an agent, the figures
    expect(await ui.find({ key: 'card:main' })).toBeDefined()
    expect(await ui.find({ key: 'tile:running' })).toBeDefined()
    await ui.unmount()
  }
})

test('Now: Needs you as Claude Code holds them (a question answerable here, a permission with its command, a notification verbatim, each its age), a card an agent, the plan from every source', async ($, on) => {
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

    // the agents: a card each, the Orchestrator first and then those at work as they started; each name keyed as `j` and `k` move to (W.agentKeyOf)
    const rows = v2.agents.filter((row): row is W.V2AgentRow => row.row === 'agent').sort((x, y) => Number(y.id === 'main') - Number(x.id === 'main') || x.startedAt - y.startedAt)
    const front = rows.filter(row => !W.isFinishedRow(row))
    const behind = rows.filter(row => W.isFinishedRow(row))
    // the finished (done, failed, stopped or idle) behind one "N finished ▸" row, Clear finished beside it; opened, their cards after
    const fold = await ui.find({ key: 'finished:now:fold' })
    if (String(fold?.props.label).endsWith('▾')) await press(ui, 'finished:now:fold')
    expect(await keysOf(ui, 'agent:')).toEqual(front.map(row => W.agentKeyOf(row.id)))
    expect((await ui.find({ key: 'finished:now:fold' }))?.props).toMatchObject({ label: `${behind.length} finished ▸`, plain: true })
    expect((await ui.find({ key: 'finished:now:clear' }))?.props).toMatchObject({ label: 'Clear finished', plain: true })
    expect(await ui.find({ key: 'finished:now:show' })).toBeUndefined()
    await press(ui, 'finished:now:fold')
    const cards = [...front, ...behind]
    expect(await keysOf(ui, 'agent:')).toEqual(cards.map(row => W.agentKeyOf(row.id)))
    expect((await ui.find({ key: 'finished:now:fold' }))?.props.label).toBe(`${behind.length} finished ▾`)
    expect(await keysOf(ui, 'fold:')).toEqual(['fold:dash:agents', 'fold:dash:figures', 'fold:dash:plan', 'fold:dash:activity', 'fold:dash:files'])
    const builder = await ui.find({ key: `card:${IDS.builder}` })
    expect(builder?.text).toContain('Bash npm test -- rateLimit')
    expect(builder?.text).toContain('Waiting · 29m')
    // avatars: the gradient face with its status dot where Svg draws, the cards' first; none on the terminal
    const faces = (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).endsWith('avatar'))
    if (surface === 'desktop') expect(faces.slice(0, cards.length).map(face => face.props.alt)).toEqual(cards.map(row => `${row.title}'s avatar`))
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

test('a section`s head folds it to one line (and it stays so), another press opens it; an agent`s card opens its page, and b goes back', async ($, on) => {
  const { v2 } = await demo($, on)
  const n = v2.agents.filter(row => row.row === 'agent').length
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'fold:dash:agents')
    expect((await ui.find({ key: 'fold:dash:agents' }))?.props.label).toBe(`▸ AGENTS ${n}`)
    expect(await ui.find({ key: `agent:${IDS.scout}` })).toBeUndefined()
    await ui.redraw()
    expect(await ui.find({ key: `agent:${IDS.scout}` })).toBeUndefined()
    await press(ui, 'fold:dash:agents')
    expect((await ui.find({ key: 'fold:dash:agents' }))?.props.label).toBe(`▾ AGENTS ${n}`)
    // scout stopped: behind the finished row
    if (String((await ui.find({ key: 'finished:now:fold' }))?.props.label).endsWith('▸')) await press(ui, 'finished:now:fold')
    expect((await ui.find({ key: `card:${IDS.scout}` }))?.text).toContain('Stopped')

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

test('5 opens Settings: Inspect (the context, the spend, the tokens and requests, a row an agent), the avatar style, Open in browser and Help; Chat with <agent> on its page opens Chat with it picked in the member list, no @ typed', async ($, on) => {
  const { v2 } = await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:settings')
    expect((await ui.find({ key: 'tab:settings' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ key: 'tab:now' }))?.props.dimColor).toBe(true)
    // Inspect: the figures in tiles, then a row an agent, in the state's order
    expect((await ui.find({ key: 'inspect:tile:context' }))?.text).toContain('41%')
    expect((await ui.find({ key: 'inspect:tile:spend' }))?.text).toContain('$4.12')
    expect((await ui.find({ key: 'inspect:tile:tokens' }))?.text).toContain('Tokens')
    expect((await ui.find({ key: 'inspect:tile:requests' }))?.text).toContain(String(v2.inspect.agents.reduce((n, one) => n + one.requests, 0)))
    const builder = (await ui.find({ key: `inspect:${IDS.builder}` }))?.text ?? ''
    for (const said of ['builder', 'sonnet-4.5', '96k', '14.8k', '402k', '18']) expect(builder).toContain(said)
    expect(await keysOf(ui, 'inspect:open:')).toEqual(v2.inspect.agents.map(one => `inspect:open:${one.id}`))
    // the linter's failed call counts in red under Errors
    expect((await ui.find({ key: 'inspect:head' }))?.text).toContain('Errors')
    // the web page, as /deck web opens it
    expect((await ui.find({ key: 'web:open' }))?.props.label).toBe('Open in browser')
    // Help: each tab, then the keys that are left
    const help = (await ui.find({ key: 'help' }))?.text ?? ''
    for (const said of ['1  Dashboard', '2  Chat', '3  Org', '4  Changes', '5  Settings', 'pick Everyone or one agent', 'back from an agent’s page']) expect(help).toContain(said)
    expect(help).not.toMatch(/\bj\b.*down|Inspect: the context/)
    // a name in Inspect opens its page
    await press(ui, `inspect:open:${IDS.builder}`)
    expect((await ui.find({ key: 'page:head' }))?.text).toContain('builder')
    await press(ui, 'key:b')
    expect((await ui.find({ key: 'tab:settings' }))?.props.dimColor).toBe(false)

    await press(ui, `inspect:open:${IDS.builder}`)
    await press(ui, 'page:chatwith')
    expect((await ui.find({ key: 'tab:chat' }))?.props.dimColor).toBe(false)
    expect(await ui.find({ key: 'page:head' })).toBeUndefined()
    expect((await ui.find({ key: `chat:filter:${IDS.builder}` }))?.props.dimColor).toBe(false)
    expect((await ui.find({ type: 'Input' }))?.props.value).toBe('')
    expect((await ui.find({ type: 'Input' }))?.props.placeholder).toBe('Message builder…')
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

test('from 120 cells Recent activity and Files stand side by side, the cards four a row at 140; below, one under the other, two cards a row; top to bottom what needs you, the agents, the figures, the plan', async ($, on) => {
  await demo($, on)
  for (const surface of SURFACES) {
    const wide = await $.ui.mount(pane(surface, 140))
    expect((await wide.find({ key: 'now:lists' }))?.props.flexDirection).toBe('row')
    expect((await wide.findAll({ type: 'Box' })).filter(box => (box.key ?? '').startsWith('cards:'))[0]?.text).toContain('Orchestrator')
    await wide.unmount()
    const narrow = await $.ui.mount(pane(surface, 84))
    expect((await narrow.find({ key: 'now:lists' }))?.props.flexDirection).toBe('column')
    const now = (await narrow.find({ key: 'now' }))?.text ?? ''
    expect(now.indexOf('NEEDS YOU')).toBeLessThan(now.indexOf('AGENTS'))
    expect(now.indexOf('AGENTS')).toBeLessThan(now.indexOf('FIGURES'))
    expect(now.indexOf('FIGURES')).toBeLessThan(now.indexOf('PLAN'))
    expect(now.indexOf('PLAN')).toBeLessThan(now.indexOf('RECENT ACTIVITY'))
    await narrow.unmount()
  }
})
