/**
 * Now, the dashboard, on the v2 state's own data, on the terminal and the
 * desktop: a card an agent in rows that follow the pane's width (its name,
 * pill and "Open →"; its own todo in hand or its task; its call in flight
 * verbatim or what it handed back; model · tokens and when it ran), every
 * line of a card opening its page; the figures (the plan's only where Claude
 * made one); Recent activity and Files as bordered lists, side by side from
 * 120 cells; each section's head folding it to one line, kept in the view;
 * the rows `j` and `k` move over (the needs, then the cards); and the
 * drawing well inside what a desktop draws.
 *
 * Drawn by `/deck demo` over the v2 sample (tests/v2session.ts), with the
 * calls, files and figures the engine builds laid over it here, so each
 * test says exactly what it draws from.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as M from '../hooks/model'
import * as D from '../hooks/ui/v2/dashModel'
import { nowFocusKeys } from '../hooks/ui/v2/now'
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
    viewport: { columns: bodyColumns + 4, rows: 400, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} },
  }
}

type Drawing = { press: (target: { key: string }) => Promise<unknown>; redraw: () => Promise<void> }

async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

type Extras = { activity: W.V2Activity[]; files: W.V2File[]; figures: W.V2Figures }

/** The sample's state as the engine builds it, with `extra` laid over it. */
function sampleState(extra: (v2: W.WebStateV2) => Partial<Extras> & Partial<W.WebStateV2> = () => ({})): W.WebStateV2 {
  const session = v2Session()
  const v2 = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  return { ...v2, ...extra(v2) } as W.WebStateV2
}

/** `/deck demo` reads `state` as the sample, with the sample's agent files and patches. */
function serve(on: On, state: W.WebStateV2) {
  const session = v2Session()
  const agentFiles = new Map(W.agentFilesOf(session.data).map(one => [one.id, one.text]))
  const patches = new Map(session.data.edits.map(edit => [W.webIdOf(edit.id), edit.patch]))
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(state) }
    const agent = /\/web\/fixtures\/v2\/agents\/([^/]+)\.json$/.exec(path)?.[1]
    if (agent && agentFiles.has(agent)) return { value: agentFiles.get(agent)! }
    const patch = /\/web\/fixtures\/v2\/patches\/([^/]+)\.diff$/.exec(path)?.[1]
    if (patch && patches.has(patch)) return { value: patches.get(patch)! }
    return { deny: 'no such file' }
  })
}

/** The engine, `state` served as the sample, `/deck demo` shown. */
async function demo($: Engine, on: On, state: W.WebStateV2) {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  serve(on, state)
  on('ui.focus', () => ({}))
  const w = newWorld()
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  return { clock, w }
}

/** Whether `word` is drawn in the element keyed `key`: its text on the terminal; where a desktop draws it as an image (a pill, a tag), an image of that word. */
async function says(ui: { find: (q: { key: string }) => Promise<{ text: string } | undefined>; findAll: (q: { type: 'Svg' }) => Promise<{ props: Record<string, unknown> }[]> }, surface: Surface, key: string, word: string): Promise<boolean> {
  if (surface === 'terminal') return ((await ui.find({ key }))?.text ?? '').includes(word)
  return (await ui.findAll({ type: 'Svg' })).some(svg => svg.props.alt === word)
}

async function keysOf(ui: { findAll: (q: { type: 'Button' }) => Promise<{ key?: string }[]> }, prefix: string): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith(prefix))
}

async function boxesOf(ui: { findAll: (q: { type: 'Box' }) => Promise<{ key?: string; props: Record<string, unknown>; text: string }[]> }, prefix: string) {
  return (await ui.findAll({ type: 'Box' })).filter(box => (box.key ?? '').startsWith(prefix))
}

/** The cards' agents in the order Now draws them: the Orchestrator and those at work by when each started, then (the finished row open) the finished. */
function cardOrder(state: W.WebStateV2, isFinishedOpen = false): W.V2AgentRow[] {
  const groups = D.cardAgentsOf(state, isFinishedOpen)
  return [...groups.shown, ...groups.finished]
}

/** Opens the Dashboard's "N finished" row where it is folded. */
async function openFinished(ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined>; press: (q: { key: string }) => Promise<unknown>; redraw: () => Promise<void> }) {
  const fold = await ui.find({ key: 'finished:now:fold' })
  if (!String(fold?.props.label ?? '').endsWith('▸')) return
  await ui.press({ key: 'finished:now:fold' })
  await ui.redraw()
}

function nodesOf(node: unknown): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node !== 'object') return 1
  const children = (node as { children?: unknown[] }).children ?? []
  return 1 + children.reduce((sum: number, child) => sum + nodesOf(child), 0)
}

const FIGURES: W.V2Figures = { running: 1, waiting: 2, done: 3, failed: 1, stopped: 1, plan: { done: 1, total: 3 }, costUsd: 4.12, tokens: 2_305_400, contextPercent: 41, minutes: 40, needs: 4 }

test('cards a row follow the width: clamp(floor((cols + 1) / 33), 1, 6): one below 65 cells, two at the usual 68 to 84, three at 120, four at 160, six at the widest', () => {
  expect([40, 64, 65, 68, 84, 97, 98, 120, 131, 160, 164, 197, 244].map(D.cardsPerRow)).toEqual([1, 1, 2, 2, 2, 2, 3, 3, 4, 4, 5, 6, 6])
})

test('what a card says comes from the agent itself: its own todo in hand (else its task`s first line, the Orchestrator`s your request) with n/total; its call in flight verbatim, else what it handed back; when it ran', () => {
  const state = sampleState()
  const rows = D.agentRowsOf(state)
  const main = rows.find(row => row.id === 'main')!
  const builder = rows.find(row => row.id === IDS.builder)!
  const tester = rows.find(row => row.id === IDS.tester)!
  const scout = rows.find(row => row.id === IDS.scout)!
  // the Orchestrator's own todo in hand, its words for what it does, and its list's count
  const active = main.todos.find(todo => todo.status === 'active')!
  expect(D.chipOf(state, main)).toEqual({ text: active.doing ?? active.text, glyph: 'waiting', n: `${main.todos.filter(todo => todo.status === 'done').length}/${main.todos.length}` })
  // no todos: its task's first line, no count
  expect(D.chipOf(state, builder)).toMatchObject({ text: D.firstLine(builder.task), n: '' })
  expect(D.chipOf(state, { ...main, todos: [] }).text).toBe(state.header.goal?.headline)
  // the call in flight, verbatim; else, once it is not at work, what it handed back as one line; never a word made up
  expect(D.cardLine(builder)).toBe('Bash npm test -- rateLimit')
  expect(D.cardLine(tester)).toBe(D.plainLine(tester.result))
  expect(D.cardLine({ ...builder, live: null, status: 'running' })).toBe('')
  expect(D.plainLine('Here it is.\n\n- **researcher** mapped `src/app.ts`\n## Next')).toBe('Here it is. researcher mapped `src/app.ts` Next')
  // its foot
  expect(D.modelLine(builder)).toBe(`sonnet-4.5 · ${builder.tokens >= 1e5 ? `${Math.round(builder.tokens / 1000)}k` : ''}`)
  expect(D.runTitle(tester, tester.endedAt! + 12 * 60_000)).toBe('Finished 12m ago')
  expect(D.runTitle(scout, scout.endedAt! + 60_000)).toBe('Stopped 1m ago')
  expect(D.runTitle({ ...builder, status: 'running' }, builder.startedAt + 3 * 3_600_000)).toBe('Started 3h ago')
  expect(D.runTitle(builder, builder.startedAt + 29 * 60_000)).toBe('Waiting · 29m')
  // a message woke it: resumed, its run since then, no new start
  const woken = { ...tester, status: 'running' as const, endedAt: null, resumedAt: tester.startedAt + 20 * 60_000 }
  expect(D.runTitle(woken, woken.resumedAt + 60_000)).toBe('Resumed 1m ago')
  expect(D.runShort(woken, woken.resumedAt + 60_000)).toBe('1m ago')
})

test('a card an agent, in the order they started: the avatar, the name (keyed agent:<id>), its pill and Open →; the step box; the now line; model · tokens and when; every line of it opens the agent`s page', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  const order = cardOrder(state, true)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // those at work in front; the finished behind "N finished ▸", opened here
    const front = cardOrder(state)
    expect(front.every(row => !W.isFinishedRow(row))).toBe(true)
    expect(order.length).toBeGreaterThan(front.length)
    await openFinished(ui)
    expect(await keysOf(ui, 'agent:')).toEqual(order.map(row => W.agentKeyOf(row.id)))
    expect((await boxesOf(ui, 'card:')).map(box => box.key)).toEqual(order.map(row => `card:${row.id}`))
    const builder = order.find(row => row.id === IDS.builder)!
    const card = (await ui.find({ key: `card:${IDS.builder}` }))!
    expect(card.props).toMatchObject({ borderStyle: 'round' })
    expect(card.text).toContain('builder')
    expect(await says(ui, surface, `card:${IDS.builder}`, 'waiting')).toBe(true)
    expect(card.text).toContain(D.chipOf(state, builder).text.slice(0, 20))
    expect(card.text).toContain('Bash npm test -- rateLimit')
    expect(card.text).toContain('sonnet-4.5')
    expect(card.text).toMatch(/Waiting · \d+m/)
    // a stopped agent's pill says so
    expect(await says(ui, surface, `card:${IDS.scout}`, 'stopped')).toBe(true)
    // Open → at 84 cells, where two cards stand in a row
    expect((await ui.find({ key: `card:open:${IDS.builder}` }))?.props).toMatchObject({ label: 'Open →', plain: true })
    // avatars where Svg draws, the cards' first and in their order
    const faces = (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).endsWith('avatar'))
    if (surface === 'desktop') expect(faces.slice(0, order.length).map(face => face.props.alt)).toEqual(order.map(row => `${row.title}'s avatar`))
    else expect(await ui.findAll({ type: 'Svg' })).toEqual([])
    // each line of the card opens its page, and b comes back to Now
    for (const key of [W.agentKeyOf(IDS.builder), `card:open:${IDS.builder}`, `card:step:${IDS.builder}`, `card:now:${IDS.builder}:0`, `card:foot:${IDS.builder}`, `card:time:${IDS.builder}`]) {
      await press(ui, key)
      expect((await ui.find({ key: 'page:head' }))?.text).toContain('builder')
      await press(ui, 'key:b')
      expect(await ui.find({ key: 'now:agents' })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('at 68, 84, 120 and 160 cells the cards stand in rows of cardsPerRow, every card as wide, no row wider than the pane, each row`s cards as tall', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  const n = cardOrder(state).length
  for (const surface of SURFACES) {
    for (const columns of [68, 84, 120, 160]) {
      const ui = await $.ui.mount(pane(surface, columns))
      const tab = Math.max(24, columns - 1)
      const perRow = D.cardsPerRow(tab)
      const rows = await boxesOf(ui, 'cards:')
      expect(rows.length).toBe(Math.ceil(n / perRow))
      const widths = (await boxesOf(ui, 'card:')).map(box => Number(box.props.width))
      expect(new Set(widths).size).toBe(1)
      expect(perRow * (widths[0] ?? 0) + (perRow - 1)).toBeLessThanOrEqual(tab)
      // each card's now line takes as many lines as its row's longest
      const bodies = (await ui.findAll({ type: 'Box' })).filter(box => box.props.overflow === 'hidden' && typeof box.props.height === 'number')
      expect(bodies.length).toBe(n)
      await ui.unmount()
    }
  }
})

test('the figures, as the engine counts them: agents running with n waiting · n done · n failed; the plan`s steps only where Claude made a plan; the spend with tokens · min · context; what waits on you', async ($, on) => {
  const state = sampleState(() => ({ figures: FIGURES }))
  await demo($, on, state)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 160))
    expect((await boxesOf(ui, 'tile:')).map(box => box.key)).toEqual(['tile:running', 'tile:plan', 'tile:spend', 'tile:waiting'])
    const running = (await ui.find({ key: 'tile:running' }))!.text
    expect(running).toContain('1')
    expect(running).toContain('Agents running')
    expect(running).toContain('2 waiting · 3 done · 1 failed · 1 stopped')
    expect((await ui.find({ key: 'tile:plan' }))?.text).toContain('1/3')
    const spend = (await ui.find({ key: 'tile:spend' }))!.text
    expect(spend).toContain('$4.12')
    expect(spend).toContain('2.3M tokens · 40 min · context 41%')
    const waiting = (await ui.find({ key: 'tile:waiting' }))!.text
    expect(waiting).toContain('4')
    expect(waiting).toContain('Orchestrator asks: Which store should back the limiter in production?')
    await ui.unmount()
  }
})

test('where Claude made no plan, no plan tile and no Plan section: three figures a row', async ($, on) => {
  await demo($, on, sampleState(() => ({ figures: { ...FIGURES, plan: null }, plan: null })))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await boxesOf(ui, 'tile:')).map(box => box.key)).toEqual(['tile:running', 'tile:spend', 'tile:waiting'])
    expect(await ui.find({ key: 'now:plan' })).toBeUndefined()
    expect(await ui.find({ key: 'fold:dash:plan' })).toBeUndefined()
    await ui.unmount()
  }
})

test('Recent activity: the newest calls first, each its face, its agent`s name, the verb and what it was given, how it went and when; a press opens that agent', async ($, on) => {
  const state = sampleState(v2 => ({
    activity: [
      { id: 'c1', at: v2.now - 600_000, agent: IDS.builder, agentName: 'builder', tool: 'Edit', text: 'src/rateLimit.ts', ok: true, ms: 250 },
      { id: 'c2', at: v2.now - 120_000, agent: IDS.builder, agentName: 'builder', tool: 'Bash', text: 'npm test -- rateLimit', ok: null, ms: null },
      { id: 'c3', at: v2.now - 300_000, agent: IDS.linter, agentName: 'Lint the new files', tool: 'Bash', text: 'eslint src', ok: false, ms: 1200 },
      { id: 'c4', at: v2.now - 60_000, agent: 'gone', agentName: 'ghost', tool: 'mcp__github__get_issue', text: '42', ok: true, ms: 840 },
    ],
  }))
  await demo($, on, state)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await boxesOf(ui, 'act:')).map(box => box.key)).toEqual(['act:c4', 'act:c2', 'act:c3', 'act:c1'])
    const live = (await ui.find({ key: 'act:c2' }))!.text
    expect(live).toContain('builder')
    expect(live).toContain(' ran ')
    expect(live).toContain('npm test -- rateLimit')
    expect(live).toContain('◐ waiting')
    expect(live).toContain('2m')
    expect((await ui.find({ key: 'act:c3' }))?.text).toContain('✕ failed')
    expect((await ui.find({ key: 'act:c1' }))?.text).toContain('edited')
    expect((await ui.find({ key: 'act:c1' }))?.text).toContain('250ms')
    expect((await ui.find({ key: 'act:c4' }))?.text).toContain('used an MCP tool on')
    // the name and the words open the agent's page; an agent the state does not hold opens nothing
    await press(ui, 'now:act:c2')
    expect((await ui.find({ key: 'page:head' }))?.text).toContain('builder')
    await press(ui, 'key:b')
    await press(ui, 'now:acttext:c3')
    expect((await ui.find({ key: 'page:head' }))?.text).toContain('Lint the new files')
    await press(ui, 'key:b')
    await press(ui, 'now:act:c4')
    expect(await ui.find({ key: 'page:head' })).toBeUndefined()
    await ui.unmount()
  }
})

test('Files: the repository`s files edited last first, the folder dim and the name pressed, "shared" for two or more editors, their faces, +a −r; the files outside it fold into one row; a press opens Changes on that file', async ($, on) => {
  const state = sampleState(v2 => ({
    files: [
      { path: 'src/rateLimit.ts', editors: [IDS.builder, IDS.tester], added: 10, removed: 0, lastAt: v2.now - 200_000 },
      { path: 'src/app.ts', editors: [IDS.builder], added: 2, removed: 1, lastAt: v2.now - 100_000 },
      { path: 'C:/Users/sam/AppData/Local/Temp/bench.js', editors: [IDS.builder], added: 12, removed: 0, lastAt: v2.now - 50_000, isOutside: true },
    ],
  }))
  await demo($, on, state)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'fold:dash:files' }))?.props.label).toBe('▾ FILES 2')
    expect((await boxesOf(ui, 'files:')).map(box => box.key)).toEqual(['files:src/app.ts', 'files:src/rateLimit.ts', 'files:outside'])
    const shared = (await ui.find({ key: 'files:src/rateLimit.ts' }))!.text
    expect(shared).toContain('src/')
    expect(await says(ui, surface, 'files:src/rateLimit.ts', 'shared')).toBe(true)
    expect(shared).toContain('+10')
    expect(shared).toContain('−0')
    if (surface === 'terminal') expect((await ui.find({ key: 'files:src/app.ts' }))?.text).not.toContain('shared')
    else expect((await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.alt === 'shared')).toHaveLength(1)
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some(svg => svg.props.alt === 'builder, tester')).toBe(true)
    // the files outside the repository: one row, opened on a press by their last two parts
    expect((await ui.find({ key: 'now:files:outside' }))?.props.label).toBe('1 file outside the repo')
    await press(ui, 'now:files:outside')
    expect((await ui.find({ key: 'files:C:/Users/sam/AppData/Local/Temp/bench.js' }))?.text).toContain('…/Temp/')
    await press(ui, 'now:files:outside')
    expect(await ui.find({ key: 'files:C:/Users/sam/AppData/Local/Temp/bench.js' })).toBeUndefined()
    // a press opens Changes on that file
    await press(ui, 'now:file:src/app.ts')
    expect((await ui.find({ key: 'tab:changes' }))?.props.dimColor).toBe(false)
    expect(await ui.find({ key: 'filediff:src/app.ts' })).toBeDefined()
    await press(ui, 'file:src/app.ts')
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('each section`s head is one plain Button, "▾ AGENTS 8"; a press folds it to its head and one dim line, another opens it; what is folded stays in the deck`s view', async ($, on) => {
  const state = sampleState(() => ({ figures: FIGURES }))
  await demo($, on, state)
  const n = D.agentRowsOf(state).length
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await keysOf(ui, 'fold:dash:')).toEqual(['fold:dash:agents', 'fold:dash:figures', 'fold:dash:plan', 'fold:dash:activity', 'fold:dash:files'])
    expect((await ui.find({ key: 'fold:dash:agents' }))?.props).toMatchObject({ label: `▾ AGENTS ${n}`, plain: true })
    await press(ui, 'fold:dash:agents')
    expect((await ui.find({ key: 'fold:dash:agents' }))?.props.label).toBe(`▸ AGENTS ${n}`)
    expect(await keysOf(ui, 'agent:')).toEqual([])
    expect((await ui.find({ key: 'now:agents' }))?.text).toContain('· 2 waiting · 1 failed · 1 stopped · 3 done')
    await press(ui, 'fold:dash:figures')
    expect(await ui.find({ key: 'tile:running' })).toBeUndefined()
    expect((await ui.find({ key: 'now:figures' }))?.text).toContain('1 running · 1/3 steps · $4.12 · 4 waiting on you')
    await press(ui, 'fold:dash:plan')
    expect((await ui.find({ key: 'now:plan' }))?.text).not.toContain('Task board')
    // a new drawing of the pane keeps them folded
    await ui.unmount()
    const again = await $.ui.mount(pane(surface))
    expect((await again.find({ key: 'fold:dash:agents' }))?.props.label).toBe(`▸ AGENTS ${n}`)
    for (const key of ['fold:dash:agents', 'fold:dash:figures', 'fold:dash:plan']) await press(again, key)
    // those at work; the finished behind their row
    expect(await keysOf(again, 'agent:')).toHaveLength(cardOrder(state).length)
    expect((await again.find({ key: 'now:plan' }))?.text).toContain('Task board')
    await again.unmount()
  }
})

test('j and k move over what needs you, then the cards, in the order drawn, each a Button drawn under that key; with the agents folded, over the needs alone', async ($, on) => {
  const state = sampleState()
  await demo($, on, state)
  const needs = state.needs.map(need => W.needKeyOf(need.id))
  const cards = cardOrder(state).map(row => W.agentKeyOf(row.id))
  expect(nowFocusKeys(state, [])).toEqual([...needs, ...cards])
  expect(nowFocusKeys(state, ['dash:agents'])).toEqual(needs)
  expect(nowFocusKeys(state, ['dash:files', 'dash:plan'])).toEqual([...needs, ...cards])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const drawn = new Set((await ui.findAll({ type: 'Button' })).map(button => button.key ?? ''))
    expect(nowFocusKeys(state, []).every(key => drawn.has(key))).toBe(true)
    await ui.unmount()
  }
})

test('from 120 cells Recent activity and Files stand side by side; below, one under the other; top to bottom Needs you, Agents, Figures, Plan, Recent activity, Files', async ($, on) => {
  await demo($, on, sampleState(() => ({ figures: FIGURES })))
  for (const surface of SURFACES) {
    const wide = await $.ui.mount(pane(surface, 140))
    expect((await wide.find({ key: 'now:lists' }))?.props.flexDirection).toBe('row')
    await wide.unmount()
    const narrow = await $.ui.mount(pane(surface, 84))
    expect((await narrow.find({ key: 'now:lists' }))?.props.flexDirection).toBe('column')
    const now = (await narrow.find({ key: 'now' }))?.text ?? ''
    const at = ['NEEDS YOU', 'AGENTS', 'FIGURES', 'PLAN', 'RECENT ACTIVITY', 'FILES'].map(word => now.indexOf(word))
    expect(at.every(one => one >= 0)).toBe(true)
    expect([...at].sort((x, y) => x - y)).toEqual(at)
    await narrow.unmount()
  }
})

test('Now stays well inside what a desktop draws (2000 elements, 90k characters of text): twenty agents, ten calls, ten files and forty outside the repository open', async ($, on) => {
  const state = sampleState(v2 => {
    const builder = D.rowOf(v2, IDS.builder)!
    const more = Array.from({ length: 20 }, (_, i): W.V2AgentRow => ({ ...builder, id: `extra${i}`, fileId: `extra${i}`, title: `worker number ${i} with a long name`, startedAt: builder.startedAt + i * 1000, fold: null }))
    return {
      agents: [...v2.agents, ...more],
      activity: Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, at: v2.now - i * 1000, agent: `extra${i % 20}`, agentName: `worker number ${i % 20}`, tool: 'Bash', text: `npm run step-${i} -- --verbose ${'x'.repeat(80)}`, ok: true, ms: 200 + i })),
      files: [
        ...Array.from({ length: 30 }, (_, i) => ({ path: `src/deep/folder/file${i}.ts`, editors: [IDS.builder, IDS.tester, 'extra1', 'extra2'], added: i, removed: i, lastAt: v2.now - i * 1000 })),
        ...Array.from({ length: 40 }, (_, i) => ({ path: `C:/Users/sam/AppData/Local/Temp/scratch/out${i}.txt`, editors: [`extra${i % 20}`], added: 1, removed: 0, lastAt: v2.now - i * 1000, isOutside: true as const })),
      ],
      figures: FIGURES,
    }
  })
  await demo($, on, state)
  for (const surface of SURFACES) {
    for (const columns of [68, 244]) {
      const ui = await $.ui.mount(pane(surface, columns))
      await press(ui, 'now:files:outside')
      expect((await boxesOf(ui, 'card:')).length).toBe(D.MOST_CARDS)
      expect((await boxesOf(ui, 'act:')).length).toBe(10)
      expect((await boxesOf(ui, 'files:')).filter(box => box.key !== 'files:outside' && box.key !== 'files:outside:more').length).toBe(10 + 20)
      expect((await ui.find({ key: 'files:outside:more' }))?.text).toContain('and 20 more files outside the repo')
      const tree = await ui.drawn()
      expect(nodesOf(tree)).toBeLessThan(2000)
      const text = (await ui.findAll({ type: 'Text' })).reduce((sum, one) => sum + one.text.length, 0)
      expect(text).toBeLessThan(90_000)
      expect(JSON.stringify(tree).length).toBeLessThan(262_144)
      await press(ui, 'now:files:outside')
      await ui.unmount()
    }
  }
})

test('the view keeps what is folded as strings, each once, the newest fifty; collapsedWith folds, opens and toggles one', () => {
  const view = M.defaultView()
  expect(view.collapsed).toEqual([])
  expect(M.collapsedWith([], 'dash:agents')).toEqual(['dash:agents'])
  expect(M.collapsedWith(['dash:agents'], 'dash:agents')).toEqual([])
  expect(M.collapsedWith(['dash:agents', 'dash:files'], 'dash:agents', true)).toEqual(['dash:files', 'dash:agents'])
  expect(M.collapsedWith(['dash:agents'], 'dash:files', false)).toEqual(['dash:agents'])
  expect(M.collapsedWith(Array.from({ length: 50 }, (_, i) => `s${i}`), 'dash:plan')).toHaveLength(50)
})
