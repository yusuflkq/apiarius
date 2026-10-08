import type { On } from 'claude-code'
import { expect, mock, test, type ElementQuery, type Engine, type FoundElement } from 'claude-code/testing'

import * as M from '../hooks/model'
import { T } from '../hooks/ui/theme'
import type { DeckAgent, DeckData, DeckSnapshot } from '../types'

/**
 * The Agents tab's header and outline, drawn through the deck's pane on the
 * terminal and the desktop: what needs you, the goal and the summary; the
 * Orchestrator, its plan steps, the agents under the step each serves and
 * their sub-agents; selection, folds, zoom and the keys that drive them.
 */

const NOW = 1_700_000_100_000
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const PANE = {
  title: 'Agent Deck',
  isFocused: true,
  bodyColumns: 96,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

const VIEWPORT = { columns: 100, rows: 50, isFullscreen: true }

const GOAL = 'Make the deck readable: plan, who does what, files'
const STEPS = ['Read the deck and the design system', 'Build the outline view', 'Review and test'] as const

function pane(surface: Surface) {
  return { plugin: 'agent-deck', surface, component: 'Pane' as const, requestId: 'agent-deck', viewport: VIEWPORT, props: PANE }
}

/** /deck as typed at the prompt, with what the engine stamps on it. */
function deck(args: string) {
  return { command: 'deck', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 100 } }
}

/** What git prints in a repository at /repo where Phase A's edit of hooks/model.ts is uncommitted. */
function gitOut(argv: readonly string[]): { exitCode: number; stdout: string } {
  const line = argv.join(' ')
  if (line.includes('rev-parse --show-toplevel')) return { exitCode: 0, stdout: '/repo\n' }
  if (line.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: 'main\n' }
  if (line.includes('rev-parse --verify --quiet HEAD')) return { exitCode: 0, stdout: `${'a'.repeat(40)}\n` }
  if (line.includes('status --porcelain')) return { exitCode: 0, stdout: ' M hooks/model.ts\0' }
  if (line.includes('--numstat -z HEAD')) return { exitCode: 0, stdout: '88\t12\thooks/model.ts\0' }
  if (line.includes('rev-list --count')) return { exitCode: 0, stdout: '0\n' }
  return { exitCode: 1, stdout: '' }
}

/** Answers every engine call the deck makes, in Claude Code's place; the deck finds `restored` in `$.state`. */
function world(on: On, restored: DeckSnapshot) {
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } } }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', ($, e) => ({ value: { ...gitOut(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: NOW, isLink: false } }))
  on('fs.read', () => ({ value: 'hello\n' }))
  on('session.send', () => ({ isDelivered: true }))
  on('state.get', { plugin: 'agent-deck', key: 'snapshot' }, () => ({ value: { value: restored, version: 1 } }))
}

const GOAL_ID = 'goal-1'

/** A subagent of this goal's, labelled `label`, spawned by the Orchestrator unless `extra` says otherwise. */
function worker(data: DeckData, id: string, label: string, extra: Partial<DeckAgent> = {}): DeckAgent {
  const made = M.newAgent(id, 'agent', label, NOW - 10 * 60_000, {
    type: 'general-purpose',
    parentId: M.MAIN,
    status: 'running',
    origin: 'agent',
    label,
    description: label,
    goal: GOAL_ID,
    ...extra,
  })
  data.agents.push(made)
  return made
}

/** The plan step the Orchestrator had in hand when it spawned an agent: its TodoWrite item. */
function during(step: number) {
  const text = STEPS[step] ?? ''
  return { kind: 'todo' as const, key: text.toLowerCase(), text }
}

/**
 * A run under way. You asked the Orchestrator to make the deck readable; its
 * plan (a TodoWrite) has three steps, the second in hand. For it, Phase A
 * and Phase B run and Phase C is done; Phase B handed the tests to "Run
 * outline tests", which waits on you to allow Bash. A compaction loop and a
 * workflow agent ran in the background.
 */
function runData(): DeckData {
  const data = M.emptyData(NOW - 18 * 60_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  main.todos = STEPS.map((text, i) => ({ key: text.toLowerCase(), text, status: i === 0 ? 'done' : i === 1 ? 'active' : 'pending' }))
  main.todosAt = NOW - 17 * 60_000
  main.todo = { text: STEPS[1] }
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: GOAL, at: NOW - 18 * 60_000 })
  data.goals = [{ id: GOAL_ID, headline: GOAL, text: GOAL, at: NOW - 18 * 60_000, followUps: [], origin: 'composer' }]

  const a = worker(data, 'agent-a', 'Phase A', { during: during(1) })
  const b = worker(data, 'agent-b', 'Phase B', { during: during(1) })
  worker(data, 'agent-c', 'Phase C', { during: during(1), status: 'completed', endedAt: NOW - 60_000, answer: 'Files section flags shared files' })
  const tester = worker(data, 'agent-t', 'Run outline tests', { parentId: b.id })
  worker(data, 'agent-compact', 'compact', { origin: 'engine', status: 'completed', endedAt: NOW - 5 * 60_000 })
  worker(data, 'agent-flow', 'flow step', { origin: 'workflow' })

  M.beginTool(data, tester, M.activityOf('call-t', 'Bash', { command: 'npm test', description: 'Run the outline tests' }, '/repo', NOW - 30_000))
  M.noteNeeds(data, { kind: 'permission_prompt', text: 'Claude needs your permission to use Bash', at: NOW - 20_000, agent: tester.id })
  M.beginTool(data, a, M.activityOf('call-a', 'Edit', { file_path: '/repo/hooks/model.ts' }, '/repo', NOW - 40_000))
  M.addEdit(data, a, { id: 'e1', agent: a.id, tool: 'Edit', path: 'hooks/model.ts', abs: '/repo/hooks/model.ts', at: NOW - 50_000, added: 88, removed: 12, patch: '@@ -1,1 +1,1 @@\n-a\n+b', isNew: false })
  return data
}

function snapshot(data: DeckData, view: Partial<DeckSnapshot['view']> = {}): DeckSnapshot {
  return { v: M.SNAPSHOT_VERSION, data, view: { ...M.defaultView(), ...view } }
}

type Drawing = {
  find: (query: ElementQuery) => Promise<FoundElement | undefined>
  findAll: (query: ElementQuery) => Promise<FoundElement[]>
}

/** The element `query` finds, or a failure naming the query and what was drawn instead. */
async function shown(ui: Drawing, query: ElementQuery): Promise<FoundElement> {
  const found = await ui.find(query)
  if (found !== undefined) return found
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  const keys = (await ui.findAll({ type: 'Button' })).map(one => one.key)
  throw new Error(`not drawn: ${String(query.text ?? query.key ?? query.type)}; texts: ${JSON.stringify(texts).slice(0, 1200)}; buttons: ${JSON.stringify(keys).slice(0, 600)}`)
}

/** The exact text, as a pattern: `find` matches a plain string anywhere inside a text. */
function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

/** The outline's rows, top to bottom, by the id each stands for. */
async function rowsOf(ui: Drawing): Promise<string[]> {
  return (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('row:')).map(key => key.slice('row:'.length))
}

type Child = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** A row's first line, as plain data: the Box of its columns. */
function firstLineOf(row: FoundElement): Child {
  return (row.children[0] ?? {}) as Child
}

/** The cells a row is indented: its fold column's left padding. */
function indentOf(row: FoundElement): number {
  const fold = (firstLineOf(row).children?.[1] ?? {}) as Child
  return Number(fold.props?.paddingLeft ?? 0)
}

/** The widths of a row's columns, left to right ('flex' for the one that grows). */
function columnsOf(row: FoundElement): string[] {
  return (firstLineOf(row).children ?? []).map(child => {
    const props = (child as Child).props ?? {}
    return props.width !== undefined ? String(props.width) : props.flexGrow ? 'flex' : '?'
  })
}

async function rowOf(ui: Drawing, id: string): Promise<FoundElement> {
  return shown(ui, { type: 'Box', key: `row:${id}` })
}

/** The detail block's title: the one bold Text exactly `title`, as its header draws it. */
async function hasTitle(ui: Drawing, title: string): Promise<boolean> {
  return (await ui.findAll({ type: 'Text', text: exactly(title) })).some(one => one.props.bold === true)
}

/** The deck restored from a snapshot of `data` (and `view`), its pane opened on the Agents tab. */
async function opened(on: On, $: Engine, data: DeckData, view: Partial<DeckSnapshot['view']> = {}) {
  const clock = mock.clock(on, { now: NOW })
  world(on, snapshot(data, view))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('agents'))
  await clock.advance(1000)
}

test('the header: what needs you on one barred row with Open (n), the goal, and one summary line', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const bars = (await ui.findAll({ type: 'Box' })).filter(box => box.props.borderStyle === 'quote' && box.props.borderColor === T.copper)
    expect(bars.length).toBe(1)
    expect(bars[0]?.text).toContain('Run outline tests')
    expect(bars[0]?.text).toContain('npm test')
    const open = await shown(ui, { key: 'needs:open' })
    expect(open.props).toMatchObject({ label: 'Open', hotkey: 'n' })
    await shown(ui, { type: 'Text', text: exactly('Goal') })
    await shown(ui, { type: 'Text', text: exactly(GOAL) })
    const summary = await shown(ui, { type: 'Text', text: /2 running/ })
    expect(summary.text).toMatch(/plan 2 of 3/)
    expect(summary.text).toMatch(/1 waits on you/)
    expect(summary.text).toMatch(/1 done/)
    expect(summary.text).toMatch(/\+88 −12/)
    await ui.unmount()
  }
})

test('the outline nests the Orchestrator, its plan steps, the agents under their step and a sub-agent under its parent', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const rows = await rowsOf(ui)
    // each step's row is its plan key: the Orchestrator's TodoWrite items
    const steps = rows.filter(id => id.startsWith('todo:'))
    expect(steps.length).toBe(3)
    const [read, build, review] = steps
    // spawn order under the step in hand; the sub-agent right under its parent; the background loops one row
    expect(rows).toEqual(['main', read, build, 'agent-a', 'agent-b', 'agent-t', 'agent-c', review, 'group:background'])
    expect(await Promise.all(rows.map(async id => indentOf(await rowOf(ui, id))))).toEqual([0, 2, 2, 4, 4, 6, 4, 2, 2])
    for (const [i, text] of STEPS.entries()) expect((await shown(ui, { key: `step:${steps[i]}` })).props.label).toBe(text)
    expect((await shown(ui, { key: 'fold:main' })).props.label).toBe('▾')
    // line two: where each agent is
    await shown(ui, { type: 'Text', text: exactly('Waits on you: allow Bash "npm test"') })
    await shown(ui, { type: 'Text', text: exactly('Done: Files section flags shared files') })
    expect((await shown(ui, { key: 'agent:main' })).props).toMatchObject({ label: 'Orchestrator', hotkey: 'o', variant: 'primary' })
    await ui.unmount()
  }
})

test('clicking a label selects its row, and the detail block below follows it', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'agent:agent-a' })
    expect((await shown(ui, { key: 'agent:agent-a' })).props.variant).toBe('primary')
    expect((await shown(ui, { key: 'agent:main' })).props.variant).toBeUndefined()
    expect(await hasTitle(ui, 'Phase A')).toBe(true)

    await ui.press({ key: 'agent:agent-b' })
    expect((await shown(ui, { key: 'agent:agent-b' })).props.variant).toBe('primary')
    expect((await shown(ui, { key: 'agent:agent-a' })).props.variant).toBeUndefined()
    expect(await hasTitle(ui, 'Phase B')).toBe(true)
    expect(await hasTitle(ui, 'Phase A')).toBe(false)

    // a plan step is a row like any other
    const build = (await rowsOf(ui)).filter(id => id.startsWith('todo:'))[1] ?? 'no step'
    await ui.press({ key: `step:${build}` })
    expect((await shown(ui, { key: `step:${build}` })).props.variant).toBe('primary')
    expect(await hasTitle(ui, STEPS[1])).toBe(true)

    // the detail's own Zoom on a step re-roots the outline there, and back out
    await ui.press({ key: 'detail:zoom' })
    expect(await rowsOf(ui)).toEqual([build, 'agent-a', 'agent-b', 'agent-t', 'agent-c'])
    expect((await shown(ui, { key: 'detail:zoom' })).props.label).toBe('Unzoom')
    await ui.press({ key: 'detail:zoom' })
    expect((await rowsOf(ui))[0]).toBe('main')

    // o: the Orchestrator again
    await ui.press({ key: 'agent:main' })
    expect((await shown(ui, { key: 'agent:main' })).props.variant).toBe('primary')
    await ui.unmount()
  }
})

test('the selected row keeps its columns: only the bar and the plate change', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const before = await rowOf(ui, 'agent-b')
    expect(before.text).not.toContain('▌')
    await ui.press({ key: 'agent:agent-b' })
    const after = await rowOf(ui, 'agent-b')
    expect(columnsOf(after)).toEqual(columnsOf(before))
    expect(columnsOf(after)).toEqual(columnsOf(await rowOf(ui, 'agent-a')))
    expect(after.text).toContain('▌')
    expect((await ui.findAll({ type: 'Text', text: exactly('▌') })).filter(one => one.props.color === T.copper).length).toBeGreaterThan(0)
    await ui.press({ key: 'agent:main' })
    await ui.unmount()
  }
})

test('Open on the needs-you line selects the agent that waits, unfolding and unzooming to show it', async ($, on) => {
  const data = runData()
  worker(data, 'agent-ah', 'A helper', { parentId: 'agent-a' })
  // Phase B folded by the person, and the outline zoomed on Phase A
  await opened(on, $, data, { folded: ['agent-b'], zoom: 'agent-a', agent: 'agent-a' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'needs:open' })
    expect((await shown(ui, { key: 'agent:agent-t' })).props.variant).toBe('primary')
    expect(await hasTitle(ui, 'Run outline tests')).toBe(true)
    expect(await ui.find({ key: 'crumb:all' })).toBeUndefined()
    // back to the person's own state for the next surface: Phase B folded, zoomed on Phase A
    await ui.press({ key: 'fold:agent-b' })
    await ui.press({ key: 'agent:agent-a' })
    await ui.press({ key: 'agent:agent-a' })
    expect(await rowsOf(ui)).toEqual(['agent-a', 'agent-ah'])
    await ui.unmount()
  }
})

test('a fold toggle folds a branch and opens it again; the branch of a finished agent starts folded', async ($, on) => {
  const data = runData()
  // Phase C, finished, had a helper of its own
  worker(data, 'agent-ch', 'C helper', { parentId: 'agent-c', status: 'completed', endedAt: NOW - 90_000 })
  await opened(on, $, data)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await rowsOf(ui)).toContain('agent-t')
    expect(await rowsOf(ui)).not.toContain('agent-ch')
    expect((await shown(ui, { key: 'fold:agent-b' })).props.label).toBe('▾')
    expect((await shown(ui, { key: 'fold:agent-c' })).props.label).toBe('▸')

    await ui.press({ key: 'fold:agent-b' })
    expect(await rowsOf(ui)).not.toContain('agent-t')
    expect((await shown(ui, { key: 'fold:agent-b' })).props.label).toBe('▸')
    await ui.press({ key: 'fold:agent-c' })
    expect(await rowsOf(ui)).toContain('agent-ch')

    await ui.press({ key: 'fold:agent-b' })
    await ui.press({ key: 'fold:agent-c' })
    expect(await rowsOf(ui)).toContain('agent-t')
    expect(await rowsOf(ui)).not.toContain('agent-ch')
    await ui.unmount()
  }
})

test('zoom re-roots the outline on the selected branch (z, or the selected row pressed again), with crumbs back up (u)', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const build = (await rowsOf(ui)).filter(id => id.startsWith('todo:'))[1] ?? 'no step'
    await ui.press({ key: 'agent:agent-b' })
    // the selected row answers z; the Orchestrator o; the others no key
    expect((await shown(ui, { key: 'agent:agent-b' })).props.hotkey).toBe('z')
    expect((await shown(ui, { key: 'agent:main' })).props.hotkey).toBe('o')
    expect((await shown(ui, { key: 'agent:agent-a' })).props.hotkey).toBeUndefined()
    await ui.press({ key: 'agent:agent-b' })

    expect(await rowsOf(ui)).toEqual(['agent-b', 'agent-t'])
    expect(indentOf(await rowOf(ui, 'agent-t'))).toBe(2)
    expect(await ui.find({ key: 'fold:agent-b' })).toBeUndefined()
    // All › Build the outline view › Phase B: the nearest level up answers u
    expect((await shown(ui, { key: 'crumb:all' })).props.label).toBe('All')
    expect((await shown(ui, { key: `crumb:${build}` })).props).toMatchObject({ label: STEPS[1], hotkey: 'u' })
    expect((await shown(ui, { key: 'crumb:all' })).props.hotkey).toBeUndefined()
    await shown(ui, { type: 'Text', text: exactly('Phase B') })

    // u: up to the step, its three agents and the sub-agent
    await ui.press({ key: `crumb:${build}` })
    expect(await rowsOf(ui)).toEqual([build, 'agent-a', 'agent-b', 'agent-t', 'agent-c'])
    expect((await shown(ui, { key: 'crumb:all' })).props.hotkey).toBe('u')
    expect((await shown(ui, { key: 'agent:agent-b' })).props.variant).toBe('primary')

    // All: everything again, the selection kept
    await ui.press({ key: 'crumb:all' })
    expect(await ui.find({ key: 'crumb:all' })).toBeUndefined()
    expect((await rowsOf(ui))[0]).toBe('main')
    expect((await shown(ui, { key: 'agent:agent-b' })).props.variant).toBe('primary')

    // z twice: in on the selection, and back out
    await ui.press({ key: 'agent:agent-b' })
    expect((await rowsOf(ui))[0]).toBe('agent-b')
    await ui.press({ key: 'agent:agent-b' })
    expect((await rowsOf(ui))[0]).toBe('main')

    // the detail's own Zoom does the same
    await ui.press({ key: 'detail:zoom' })
    expect((await rowsOf(ui))[0]).toBe('agent-b')
    await ui.press({ key: 'detail:zoom' })
    expect((await rowsOf(ui))[0]).toBe('main')
    await ui.press({ key: 'agent:main' })
    await ui.unmount()
  }
})

test('workflow and housekeeping loops fold into one dim background row', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await shown(ui, { type: 'Text', text: exactly('+2 background') })
    expect(await rowsOf(ui)).not.toContain('agent-compact')
    expect(await ui.find({ key: 'agent:agent-flow' })).toBeUndefined()
    await ui.press({ key: 'fold:group:background' })
    expect(await rowsOf(ui)).toContain('agent-compact')
    expect(await rowsOf(ui)).toContain('agent-flow')
    await ui.press({ key: 'fold:group:background' })
    expect(await rowsOf(ui)).not.toContain('agent-flow')
    await ui.unmount()
  }
})

test('past twelve agent rows a branch folds its finished agents into "+N done"', async ($, on) => {
  const data = runData()
  for (let i = 0; i < 12; i++) {
    worker(data, `agent-x${i}`, `worker ${i}`, { during: during(1), ...(i < 9 ? { status: 'completed' as const, endedAt: NOW - 30_000, answer: `Did ${i}` } : {}) })
  }
  await opened(on, $, data)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const rows = await rowsOf(ui)
    const build = rows.filter(id => id.startsWith('todo:'))[1] ?? 'no step'
    // Phase C and nine workers done: one row where Phase C sat; the three still running stay
    await shown(ui, { type: 'Text', text: exactly('+10 done') })
    expect(rows).not.toContain('agent-c')
    expect(rows).not.toContain('agent-x0')
    expect(rows).toContain('agent-x11')
    expect(rows.indexOf(`group:done:${build}`)).toBe(rows.indexOf('agent-t') + 1)
    await ui.press({ key: `fold:group:done:${build}` })
    expect(await rowsOf(ui)).toContain('agent-x0')
    await ui.press({ key: `fold:group:done:${build}` })
    await ui.unmount()
  }
})

test('with no plan the agents sit straight under the Orchestrator; an empty session says what will show', async ($, on) => {
  const data = runData()
  const main = M.agentOf(data, M.MAIN)!
  delete main.todos
  delete main.todo
  for (const agent of data.agents) delete agent.during
  await opened(on, $, data)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const rows = await rowsOf(ui)
    // an implicit plan (one step per Agent call) would only repeat the agents: no step rows
    expect((await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('step:'))).toEqual([])
    expect(rows.slice(0, 5)).toEqual(['main', 'agent-a', 'agent-b', 'agent-t', 'agent-c'])
    expect(indentOf(await rowOf(ui, 'agent-a'))).toBe(2)
    await ui.unmount()
  }
})

test('an empty session: the Orchestrator alone, and a quiet line saying what will show', async ($, on) => {
  await opened(on, $, M.emptyData(NOW - 60_000))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await rowsOf(ui)).toEqual(['main'])
    await shown(ui, { type: 'Text', text: exactly('No agents yet; delegated work shows here as it starts.') })
    await shown(ui, { type: 'Text', text: exactly('Nothing needs you') })
    expect(await ui.find({ key: 'needs:open' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Box' })).some(box => box.props.borderStyle === 'quote' && box.props.borderColor === T.copper)).toBe(false)
    await ui.unmount()
  }
})
