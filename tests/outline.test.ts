import type { On } from 'claude-code'
import { expect, mock, test, type ElementQuery, type Engine, type FoundElement } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import { detailVM } from '../hooks/ui/detail'
import { FOLD_LABEL } from '../hooks/ui/outline'
import { UNTOUCHED, headerOf, outlineOf } from '../hooks/ui/outlineModel'
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
 * workflow agent ran in the background, the workflow agent still at it.
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
  const fold = (firstLineOf(row).children?.[0] ?? {}) as Child
  return Number(fold.props?.paddingLeft ?? -1)
}

/** The widths of a row's columns, left to right ('flex' for the one that grows). */
function columnsOf(row: FoundElement): string[] {
  return (firstLineOf(row).children ?? []).map(child => {
    const props = (child as Child).props ?? {}
    return props.width !== undefined ? String(props.width) : props.flexGrow ? 'flex' : '?'
  })
}

/** Whether a Box carries the copper rail: the host's `quote` border in copper. */
function hasRail(box: FoundElement): boolean {
  return box.props.borderStyle === 'quote' && box.props.borderColor === T.copper
}

async function rowOf(ui: Drawing, id: string): Promise<FoundElement> {
  return shown(ui, { type: 'Box', key: `row:${id}` })
}

/** The label Buttons of the outline: agents (the Orchestrator too) and plan steps. */
async function labelsOf(ui: Drawing): Promise<FoundElement[]> {
  return (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('agent:') || button.key?.startsWith('step:'))
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
  await $.command.run(deck('details'))
  await clock.advance(1000)
}

test('the header: what needs you on one railed row with Open (n), the goal in bold with its minutes, and the summary', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const rails = (await ui.findAll({ type: 'Box' })).filter(hasRail)
    expect(rails.length).toBe(1)
    expect(rails[0]?.text).toContain('Run outline tests')
    expect(rails[0]?.text).toContain('npm test')
    const open = await shown(ui, { key: 'needs:open' })
    expect(open.props).toMatchObject({ label: 'Open', hotkey: 'n' })
    await shown(ui, { type: 'Text', text: exactly('Goal') })
    // the goal leads: bold, its minutes dim at the right of its line
    expect((await shown(ui, { type: 'Text', text: exactly(GOAL) })).props.bold).toBe(true)
    expect((await shown(ui, { type: 'Text', text: exactly('18m') })).props.dimColor).toBe(true)
    const summary = await shown(ui, { type: 'Text', text: /2 running/ })
    expect(summary.text).toMatch(/^Step 2 of 3 · Build the outline view · 2 running · 1 waits on you · 1 done/)
    expect(summary.text).toMatch(/\+88 −12/)
    expect(summary.text).not.toMatch(/18m/)
    await ui.unmount()
  }
})

test('the summary leads with the step in hand, plain, the counts after it dim; with every step done it says so', async ($, on) => {
  const data = runData()
  await opened(on, $, data)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const step = await shown(ui, { type: 'Text', text: exactly('Step 2 of 3 · Build the outline view') })
    expect(step.props.dimColor).toBeUndefined()
    expect(step.props.bold).toBeUndefined()
    expect((await shown(ui, { type: 'Text', text: /^2 running · 1 waits on you · 1 done · / })).props.dimColor).toBe(true)
    await ui.unmount()
  }
  // the plan done: no step in hand, and the line says the plan is through
  const done = runData()
  M.agentOf(done, M.MAIN)!.todos = STEPS.map(text => ({ key: text.toLowerCase(), text, status: 'done' as const }))
  expect(headerOf(done, emptyGit(), NOW).summary.step).toBe('All 3 steps done')
  expect(headerOf(runData(), emptyGit(), NOW).summary.step).toBe('Step 2 of 3 · Build the outline view')
})

test('nothing is selected at rest: no plate, no rail on a row, no detail block until a label is pressed', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await labelsOf(ui)).filter(button => button.props.variant === 'primary')).toEqual([])
    for (const id of await rowsOf(ui)) expect(hasRail(await rowOf(ui, id))).toBe(false)
    expect(await ui.find({ key: 'detail:edits' })).toBeUndefined()
    expect(await ui.find({ key: 'detail:zoom' })).toBeUndefined()
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.unmount()
  }
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'agent:agent-a' })
    expect(await hasTitle(ui, 'Phase A')).toBe(true)
    expect(hasRail(await rowOf(ui, 'agent-a'))).toBe(true)
    await ui.unmount()
  }
})

test('labels are plain Buttons, and only the selected one is the primary plate', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const before = await labelsOf(ui)
    expect(before.length).toBeGreaterThan(5)
    expect(before.every(button => button.props.plain === true && button.props.variant === undefined)).toBe(true)
    await ui.unmount()
  }
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'agent:agent-b' })
    for (const button of await labelsOf(ui)) {
      if (button.key === 'agent:agent-b') expect(button.props).toMatchObject({ variant: 'primary' })
      else expect(button.props).toMatchObject({ plain: true })
      if (button.key === 'agent:agent-b') expect(button.props.plain).toBeUndefined()
      else expect(button.props.variant).toBeUndefined()
    }
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
    // spawn order under the step in hand; the sub-agent right under its parent; the workflow agent at work in one background row
    expect(rows).toEqual(['main', read, build, 'agent-a', 'agent-b', 'agent-t', 'agent-c', review, 'group:background'])
    expect(await Promise.all(rows.map(async id => indentOf(await rowOf(ui, id))))).toEqual([0, 2, 2, 4, 4, 6, 4, 2, 2])
    for (const [i, text] of STEPS.entries()) expect((await shown(ui, { key: `step:${steps[i]}` })).props.label).toBe(text)
    expect((await shown(ui, { key: 'fold:main' })).props.label).toBe(FOLD_LABEL.open)
    // line two: where each agent is
    await shown(ui, { type: 'Text', text: exactly('Needs your OK to run `npm test`') })
    await shown(ui, { type: 'Text', text: exactly('Done: Files section flags shared files') })
    expect((await shown(ui, { key: 'agent:main' })).props).toMatchObject({ label: 'Orchestrator', hotkey: 'o', plain: true })
    await ui.unmount()
  }
})

test('step names run the full width; an agent row keeps a fixed label column with its numbers right after it', async ($, on) => {
  const data = runData()
  const main = M.agentOf(data, M.MAIN)!
  const long = 'Build the outline view, the Files section, the detail block and every test that covers them'
  main.todos = STEPS.map((text, i) => ({ key: text.toLowerCase(), text: i === 1 ? long : text, status: i === 0 ? 'done' : i === 1 ? 'active' : 'pending' }))
  for (const agent of data.agents) if (agent.during?.text === STEPS[1]) agent.during = { kind: 'todo', key: STEPS[1].toLowerCase(), text: long }
  await opened(on, $, data)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const build = (await rowsOf(ui)).filter(id => id.startsWith('todo:'))[1] ?? 'no step'
    // the step's row: its fold, its mark, then its label growing to the pane's edge; no columns after it
    expect(columnsOf(await rowOf(ui, build))).toEqual(['4', '2', 'flex'])
    expect(String((await shown(ui, { key: `step:${build}` })).props.label).length).toBeGreaterThan(60)
    // agent rows: the label column narrows a level deeper so done/total, minutes and +a −r start on the same cell
    const a = columnsOf(await rowOf(ui, 'agent-a'))
    const t = columnsOf(await rowOf(ui, 'agent-t'))
    expect(a).toEqual(['6', '2', '22', '6', '7', '12'])
    expect(t).toEqual(['8', '2', '20', '6', '7', '12'])
    const end = (columns: string[]) => columns.slice(0, 3).reduce((sum, one) => sum + Number(one), 0)
    expect(end(a)).toBe(end(t))
    await ui.unmount()
  }
})

test('nesting indents four levels at most; a deeper row keeps the fourth level and its columns', async ($, on) => {
  const data = runData()
  worker(data, 'agent-a1', 'A one', { parentId: 'agent-a' })
  worker(data, 'agent-a2', 'A two', { parentId: 'agent-a1' })
  worker(data, 'agent-a3', 'A three', { parentId: 'agent-a2' })
  await opened(on, $, data)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const depths = await Promise.all(['agent-a', 'agent-a1', 'agent-a2', 'agent-a3'].map(async id => indentOf(await rowOf(ui, id))))
    expect(depths).toEqual([4, 6, 8, 8])
    expect(columnsOf(await rowOf(ui, 'agent-a2'))).toEqual(['10', '2', '18', '6', '7', '12'])
    expect(columnsOf(await rowOf(ui, 'agent-a3'))).toEqual(['10', '2', '18', '6', '7', '12'])
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

    // o: the Orchestrator
    await ui.press({ key: 'agent:main' })
    expect((await shown(ui, { key: 'agent:main' })).props.variant).toBe('primary')
    await ui.unmount()
  }
})

test('the selected row keeps its columns: only the rail and the plate change, and the rail is a border, not a glyph', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const before = await rowOf(ui, 'agent-b')
    expect(hasRail(before)).toBe(false)
    expect(before.props.paddingLeft).toBe(2)
    await ui.press({ key: 'agent:agent-b' })
    const after = await rowOf(ui, 'agent-b')
    expect(columnsOf(after)).toEqual(columnsOf(before))
    expect(columnsOf(after)).toEqual(columnsOf(await rowOf(ui, 'agent-a')))
    // the copper rail: the border's cell and one of padding, the same two cells as before
    expect(hasRail(after)).toBe(true)
    expect(after.props.paddingLeft).toBe(1)
    expect(await ui.find({ type: 'Text', text: exactly('▌') })).toBeUndefined()
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
    // where to answer it
    await shown(ui, { type: 'Text', text: exactly('Answer the prompt in the conversation.') })
    // back to the person's own state for the next surface: Phase B folded, zoomed on Phase A
    await ui.press({ key: 'fold:agent-b' })
    await ui.press({ key: 'agent:agent-a' })
    await ui.press({ key: 'detail:zoom' })
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
    // two cells to click: the arrow and a figure space
    expect(Array.from(String((await shown(ui, { key: 'fold:agent-b' })).props.label)).length).toBe(2)
    expect((await shown(ui, { key: 'fold:agent-b' })).props.label).toBe(FOLD_LABEL.open)
    expect((await shown(ui, { key: 'fold:agent-c' })).props.label).toBe(FOLD_LABEL.closed)

    await ui.press({ key: 'fold:agent-b' })
    expect(await rowsOf(ui)).not.toContain('agent-t')
    expect((await shown(ui, { key: 'fold:agent-b' })).props.label).toBe(FOLD_LABEL.closed)
    await ui.press({ key: 'fold:agent-c' })
    expect(await rowsOf(ui)).toContain('agent-ch')

    await ui.press({ key: 'fold:agent-b' })
    await ui.press({ key: 'fold:agent-c' })
    expect(await rowsOf(ui)).toContain('agent-t')
    expect(await rowsOf(ui)).not.toContain('agent-ch')
    await ui.unmount()
  }
})

test('a finished step starts folded, its agents a press away', async ($, on) => {
  const data = runData()
  worker(data, 'agent-s', 'scout', { during: during(0), status: 'completed', endedAt: NOW - 15 * 60_000, answer: 'The tab must lead with the goal.' })
  await opened(on, $, data)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const read = (await rowsOf(ui)).filter(id => id.startsWith('todo:'))[0] ?? 'no step'
    expect((await shown(ui, { key: `fold:${read}` })).props.label).toBe(FOLD_LABEL.closed)
    expect(await rowsOf(ui)).not.toContain('agent-s')
    expect(await ui.find({ type: 'Text', text: /The tab must lead/ })).toBeUndefined()
    await ui.press({ key: `fold:${read}` })
    expect((await rowsOf(ui)).slice(1, 3)).toEqual([read, 'agent-s'])
    await ui.press({ key: `fold:${read}` })
    expect(await rowsOf(ui)).not.toContain('agent-s')
    await ui.unmount()
  }
})

test('f folds and opens the selected branch from the detail; z zooms on it; a second press on its label does nothing', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'agent:agent-b' })
    // the label keys: the Orchestrator o, the others none; Fold f and Zoom z sit in the detail's header
    expect((await shown(ui, { key: 'agent:agent-b' })).props.hotkey).toBeUndefined()
    expect((await shown(ui, { key: 'agent:main' })).props.hotkey).toBe('o')
    expect((await shown(ui, { key: 'agent:agent-a' })).props.hotkey).toBeUndefined()
    expect((await shown(ui, { key: 'detail:fold' })).props).toMatchObject({ label: 'Fold', hotkey: 'f' })
    expect((await shown(ui, { key: 'detail:zoom' })).props).toMatchObject({ label: 'Zoom', hotkey: 'z' })

    // f: Phase B's branch folds, its row and selection kept; f again opens it
    await ui.press({ key: 'detail:fold' })
    expect(await rowsOf(ui)).not.toContain('agent-t')
    expect((await shown(ui, { key: 'fold:agent-b' })).props.label).toBe(FOLD_LABEL.closed)
    expect((await shown(ui, { key: 'detail:fold' })).props.label).toBe('Unfold')
    expect((await shown(ui, { key: 'agent:agent-b' })).props.variant).toBe('primary')
    await ui.press({ key: 'detail:fold' })
    expect(await rowsOf(ui)).toContain('agent-t')

    // a second press on the selected label: nothing moves
    const rows = await rowsOf(ui)
    await ui.press({ key: 'agent:agent-b' })
    expect(await rowsOf(ui)).toEqual(rows)
    expect(await ui.find({ key: 'crumb:all' })).toBeUndefined()
    expect((await shown(ui, { key: 'agent:agent-b' })).props.variant).toBe('primary')

    // a row with nothing under it has no Fold
    await ui.press({ key: 'agent:agent-a' })
    expect(await ui.find({ key: 'detail:fold' })).toBeUndefined()
    await ui.press({ key: 'agent:agent-b' })
    await ui.unmount()
  }
})

test('zoom re-roots the outline on the selected branch (z, the detail`s Zoom), with crumbs back up (u)', async ($, on) => {
  await opened(on, $, runData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const build = (await rowsOf(ui)).filter(id => id.startsWith('todo:'))[1] ?? 'no step'
    await ui.press({ key: 'agent:agent-b' })
    await ui.press({ key: 'detail:zoom' })

    expect(await rowsOf(ui)).toEqual(['agent-b', 'agent-t'])
    expect(indentOf(await rowOf(ui, 'agent-t'))).toBe(2)
    expect(await ui.find({ key: 'fold:agent-b' })).toBeUndefined()
    // All › Build the outline view › Phase B: the nearest level up answers u
    expect((await shown(ui, { key: 'crumb:all' })).props.label).toBe('All')
    expect((await shown(ui, { key: `crumb:${build}` })).props).toMatchObject({ label: STEPS[1], hotkey: 'u' })
    expect((await shown(ui, { key: 'crumb:all' })).props.hotkey).toBeUndefined()
    expect((await shown(ui, { key: 'detail:zoom' })).props.label).toBe('Unzoom')

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
    await ui.press({ key: 'detail:zoom' })
    expect((await rowsOf(ui))[0]).toBe('agent-b')
    await ui.press({ key: 'detail:zoom' })
    expect((await rowsOf(ui))[0]).toBe('main')
    await ui.unmount()
  }
})

test('workflow and housekeeping loops fold into one dim background row while a workflow`s agent works', async ($, on) => {
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

test('at rest, with no workflow agent at work, there is no background row', async ($, on) => {
  const data = runData()
  Object.assign(M.agentOf(data, 'agent-flow')!, { status: 'completed', endedAt: NOW - 1000 })
  // the engine's own loop is never seen to end: still no row for it
  worker(data, 'agent-fork', 'agent-a8c41f', { origin: 'engine' })
  await opened(on, $, data)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await rowsOf(ui)).not.toContain('group:background')
    expect(await ui.find({ type: 'Text', text: /background/ })).toBeUndefined()
    expect((await rowsOf(ui)).at(-1)).toBe((await rowsOf(ui)).filter(id => id.startsWith('todo:')).at(-1))
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

test('with no plan the agents sit straight under the Orchestrator, and the summary names no step', async ($, on) => {
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
    expect(await ui.find({ type: 'Text', text: /^Step / })).toBeUndefined()
    await shown(ui, { type: 'Text', text: /^2 running · 1 waits on you/ })
    await ui.unmount()
  }
})

test('an agent the engine holds with no prompt for you is busy: "Waiting on background work", a sage square, not counted as waiting on you', async () => {
  const data = runData()
  // Phase A is held on work of its own; Run outline tests still waits on you
  M.agentOf(data, 'agent-a')!.status = 'waiting'
  const rows = outlineOf(data, M.defaultView(), NOW).rows
  expect(rows.find(row => row.id === 'agent-a')).toMatchObject({ status: 'running', note: 'Waiting on background work', noteTone: 'dim' })
  expect(rows.find(row => row.id === 'agent-t')).toMatchObject({ status: 'waiting', note: 'Needs your OK to run `npm test`', noteTone: 'waiting' })
  expect(headerOf(data, emptyGit(), NOW).summary.lead).toMatch(/^2 running · 1 waits on you · 1 done/)
  // nothing is selected in a fresh view
  expect(rows.filter(row => row.isSelected)).toEqual([])
})

test('a finished agent`s line two is its result`s first sentence, its own "Finished:" or "Verdict:" dropped and its paths made short; the detail`s Result keeps the whole text', () => {
  const data = runData()
  const report = 'Finished: the data layer and its query functions are in, and all checks are green. `tsc -p` is clean and nothing is committed.'
  const found = '**Where the bug is:** C:\\Users\\me\\AppData\\Local\\Temp\\scratchpad\\demo-repo\\src\\token.js, line 12, in `needsRefresh`. The fix is one sign.'
  const review = '## Summary\n\nVerdict: approved, the edits to /repo/hooks/model.ts and /repo/hooks/ui/outline.tsx hold. Two nits below.'
  const ended = { status: 'completed' as const, endedAt: NOW - 60_000 }
  worker(data, 'agent-d', 'v3 data', { ...ended, answer: report })
  worker(data, 'agent-s', 'scout', { ...ended, answer: found })
  worker(data, 'agent-r', 'reviewer', { ...ended, answer: review })
  worker(data, 'agent-f', 'fixer', { status: 'failed', endedAt: NOW - 60_000, answer: 'Failed: /work/app/deep/dir/build.log shows 3 errors. Retried twice.' })
  // the repository shown is /repo: a path under it reads relative, one elsewhere as its file and two folders
  const rows = outlineOf(data, M.defaultView(), NOW, undefined, '/repo').rows
  const note = (id: string) => rows.find(row => row.id === id)?.note
  expect(note('agent-d')).toBe('Done: the data layer and its query functions are in, and all checks are green.')
  expect(note('agent-s')).toBe('Done: Where the bug is: …/demo-repo/src/token.js, line 12, in needsRefresh.')
  expect(note('agent-r')).toBe('Done: approved, the edits to hooks/model.ts and hooks/ui/outline.tsx hold.')
  expect(note('agent-f')).toBe('Failed: …/deep/dir/build.log shows 3 errors.')
  expect(note('agent-c')).toBe('Done: Files section flags shared files')
  // the detail's Result is the report as the agent wrote it
  const detail = detailVM(data, { ...M.defaultView(), agent: 'agent-d' }, emptyGit(), null, null, NOW)
  expect(detail.kind === 'agent' ? detail.result?.text : undefined).toBe(report)
})

test('resultLineOf: the words that only announce a report go, wherever they lead; the rest of a sentence, a URL and a short path stay as written', () => {
  expect(M.resultLineOf('Done.\n\nThe fix is in. Tests pass.')).toBe('The fix is in.')
  expect(M.resultLineOf('**Report:** Summary: shipped it, e.g. the parser. Next up.')).toBe('shipped it, e.g. the parser.')
  expect(M.resultLineOf('Done with the parser; tests pass.')).toBe('Done with the parser; tests pass.')
  expect(M.resultLineOf('Results show the cache holds.')).toBe('Results show the cache holds.')
  expect(M.resultLineOf('See https://example.com/a/b/c/d and C:\\a\\b.ts.')).toBe('See https://example.com/a/b/c/d and C:\\a\\b.ts.')
  expect(M.resultLineOf('Done.')).toBe('')
  expect(M.shortPathsIn('Wrote /home/me/work/demo-repo/src/token.js: 2 lines.')).toBe('Wrote …/demo-repo/src/token.js: 2 lines.')
})

test('before the first prompt the whole tab is one quiet line', async ($, on) => {
  await opened(on, $, M.emptyData(NOW - 60_000))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await rowsOf(ui)).toEqual([])
    const line = await shown(ui, { type: 'Text', text: exactly(UNTOUCHED) })
    expect(line.props).toMatchObject({ dimColor: true, italic: true })
    // nothing else of the tab: no needs-you line, no goal, no Files, no detail; the tab row stays
    for (const text of ['Nothing needs you', 'Goal', 'Files', 'No agents yet']) expect(await ui.find({ type: 'Text', text })).toBeUndefined()
    expect((await ui.findAll({ type: 'Text' })).filter(one => one.props.italic === true).length).toBe(1)
    expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toEqual(['tab:dashboard', 'tab:org', 'tab:plan', 'tab:changes', 'web:open'])
    expect((await ui.findAll({ type: 'Box' })).some(hasRail)).toBe(false)
    await ui.unmount()
  }
})
