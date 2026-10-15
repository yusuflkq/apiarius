/**
 * The Plan tab (`/deck plan`, key 3), as the web deck's Plan page draws it:
 * the goal and its follow-ups, the progress card, and a row a step that
 * opens to the agents on it (the ones they started under them) or to the
 * Orchestrator's own work: each agent's avatar, name, type and pill, now
 * line, checklist, last three calls, files, folded result and what waits on
 * you, with Open agent → and Talk →. What is open stays in the view through
 * redraws, tabs and a reload; `/deck plan <n>` opens a step the way
 * `openStep` does; the sample (`/deck demo`) opens whole; a plan too big for
 * the pane is drawn leaner; the layout keeps to the pane's 68 to 84 cells.
 *
 * tests/world.ts answers `ui.invalidate` itself, so a mounted pane is drawn
 * again by `redraw` after a press that changed what it shows. The test kit
 * has no `ui.scroll`, so the scroll `openStep` asks for is the Desktop's to
 * show: here the press only must not fail.
 */
import type { On, RenderElement } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import { TREE_BOUNDS, treeSize } from '../hooks/ui/common'
import { P, TONE } from '../hooks/ui/dash/palette'
import { planTab, stepRowKey } from '../hooks/ui/dash/plan'
import type { DashActions, Kit } from '../hooks/ui/types'
import * as W from '../hooks/web'
import type { DeckData, DeckSnapshot } from '../types'
import { deck, newWorld, NOW, world, type World } from './world'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
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

/** A press, then the drawing as the pane draws it next. */
async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

// The sample: web/fixtures/state.json's plan and agents, as `webStateOf` wrote them a month ago.

const SAMPLE_NOW = NOW - 30 * 86_400_000
const at = (minutes: number) => SAMPLE_NOW - minutes * 60_000

const STEPS = [
  'Map the routes and the middleware chain',
  'Write the sliding-window limiter and its Redis store',
  'Cover the limiter with tests',
  'Document the limits and update the changelog',
  'Review the diff and commit',
] as const

const QUESTION = {
  question: 'Where should the rate limit entry go in CHANGELOG.md?',
  header: 'Changelog',
  multiSelect: false,
  options: [
    { label: 'Add an Unreleased section', description: 'A new heading at the top.' },
    { label: 'Leave the changelog alone', description: 'You write the entry yourself.' },
  ],
}

/** Explore routes' report: six lines, so it folds to four. */
const EXPLORE_RESULT = [
  'Found 14 public routes under /v1, all mounted from src/routes/index.ts:',
  '- orders.ts: GET/POST /orders, GET/PATCH/DELETE /orders/:id',
  '- customers.ts: GET/POST /customers, GET/PATCH /customers/:id',
  '- catalog.ts: GET /products, GET /products/:id',
  '- health.ts: GET /health and GET /metrics',
  'No rate limiting anywhere in the chain.',
].join('\n')
const DOCS_RESULT = 'Updated docs/api.md with the 429 error and a Rate limits section. CHANGELOG.md has no Unreleased section, so its entry is not written.'

function checklist(items: readonly (readonly [string, 'done' | 'active' | 'pending', string?])[]): W.WebAgent['checklist'] {
  const rows = items.map(([text, status, doing]) => ({ text, status, ...(doing ? { doing } : {}) }))
  return { items: rows, done: rows.filter(row => row.status === 'done').length, total: rows.length }
}

function agentRow(over: Partial<W.WebAgent> & Pick<W.WebAgent, 'id' | 'label'>): W.WebAgent {
  return {
    scope: '',
    type: 'general-purpose',
    model: 'haiku-4.5',
    kind: 'agent',
    parent: 'main',
    status: 'running',
    needsYou: null,
    startedAt: at(30),
    endedAt: null,
    now: '',
    task: '',
    result: '',
    checklist: checklist([]),
    lastAction: null,
    tools: 0,
    errors: 0,
    tokens: { in: 0, out: 0, cacheRead: 0 },
    added: 0,
    removed: 0,
    files: [],
    avatar: 0,
    ...over,
  }
}

/** One tool call of the sample, `minutes` before it was written. */
function call(minutes: number, agent: string, tool: string, target: string, ok: boolean | null, ms: number | null): W.WebState['activity'][number] {
  return { at: at(minutes), agent, tool, target, ok, ms }
}

/** The sample's agents, the Orchestrator's checklist on its last step `last`. */
function sampleAgents(last: 'active' | 'pending'): W.WebAgent[] {
  return [
    agentRow({
      id: 'main',
      label: 'Orchestrator',
      type: 'main loop',
      model: 'opus-5.5',
      kind: 'orchestrator',
      parent: null,
      status: 'waiting',
      needsYou: `asks: ${QUESTION.question}`,
      startedAt: at(37),
      now: `Asks: ${QUESTION.question}`,
      checklist: checklist([
        [STEPS[0], 'done'],
        [STEPS[1], 'active', 'Limiter and Redis store are on it'],
        [STEPS[2], 'active', 'Tests waits on a Bash approval'],
        [STEPS[3], 'pending'],
        [STEPS[4], last, 'Reading the diff'],
      ]),
      lastAction: { tool: 'AskUserQuestion', text: QUESTION.question, at: at(0.5), isLive: true },
      avatar: 2,
    }),
    agentRow({
      id: 'a3f9c21b',
      label: 'Explore routes',
      type: 'Explore',
      status: 'done',
      startedAt: at(35),
      endedAt: at(31),
      now: 'Found 14 public routes under /v1; no limiter in place',
      result: EXPLORE_RESULT,
      checklist: checklist([
        ['List the route files', 'done'],
        ['Read the middleware chain', 'done'],
        ['Check for existing rate limiting', 'done'],
        ['Find where req.user is set', 'done'],
      ]),
      avatar: 4,
    }),
    agentRow({
      id: '4e7d0a92',
      label: 'Limiter',
      startedAt: at(29),
      now: 'Edit src/middleware/rateLimit.ts',
      checklist: checklist([
        ['Define the store interface', 'done'],
        ['Write the sliding-window middleware', 'done'],
        ['Wire it into app.ts', 'done'],
        ['Support a skip option for health checks', 'active', 'Editing src/middleware/rateLimit.ts'],
        ['Integrate the Redis store', 'pending'],
      ]),
      lastAction: { tool: 'Edit', text: 'src/middleware/rateLimit.ts', at: at(0.1), isLive: true },
      files: ['src/middleware/rateLimit.ts', 'src/middleware/stores/memoryStore.ts', 'src/app.ts', 'src/config.ts', 'src/routes/index.ts', 'src/types.ts'],
      avatar: 5,
    }),
    agentRow({
      id: 'b81c6f3e',
      label: 'Tests',
      type: 'test-writer',
      status: 'waiting',
      needsYou: 'needs your OK to run `npm test -- rateLimit`',
      startedAt: at(28),
      now: 'Needs your OK to run `npm test -- rateLimit`',
      checklist: checklist([
        ['Read the options', 'done'],
        ['Write the four cases', 'done'],
        ['Run the tests', 'active'],
        ['Fix any failures', 'pending'],
      ]),
      lastAction: { tool: 'Bash', text: 'npm test -- rateLimit', at: at(2), isLive: true },
      files: ['test/rateLimit.test.ts'],
      avatar: 9,
    }),
    agentRow({
      id: '0d5a9e47',
      label: 'Redis store',
      parent: '4e7d0a92',
      startedAt: at(20),
      now: 'Type-checking: npx tsc --noEmit -p .',
      checklist: checklist([
        ['Add ioredis', 'done'],
        ['Write the sorted-set store', 'done'],
        ['Type-check', 'active'],
      ]),
      lastAction: { tool: 'Bash', text: 'npx tsc --noEmit -p .', at: at(1), isLive: true },
      files: ['package.json', 'src/middleware/stores/redisStore.ts'],
      avatar: 2,
    }),
    agentRow({
      id: 'f26b3c18',
      label: 'Docs',
      status: 'failed',
      startedAt: at(25),
      endedAt: at(6),
      now: 'Failed: CHANGELOG.md has no "Unreleased" section to add to',
      result: DOCS_RESULT,
      checklist: checklist([
        ['Add the 429 error code', 'done'],
        ['Write the Rate limits section', 'done'],
        ['Add a changelog entry', 'pending'],
      ]),
      files: ['docs/api.md'],
      avatar: 8,
    }),
  ]
}

/**
 * The sample in web/fixtures/state.json's shape: five steps from the todo
 * list (one done, two in hand, one failed, the last the Orchestrator's own),
 * six agents (Redis store started by Limiter), a permission prompt and a
 * question the deck may answer. With `isReviewing`, the Orchestrator is on
 * its own last step.
 */
function sampleState(isReviewing = false): W.WebState {
  const last = isReviewing ? 'active' : 'pending'
  return {
    v: 1,
    now: SAMPLE_NOW,
    session: { id: 'sample', cwd: '/acme', startedAt: at(40), model: 'opus-5.5' },
    repo: null,
    goal: {
      headline: 'Add per-user rate limiting to the public API',
      text: 'Add per-user rate limiting to the public API. Use a sliding window, 100 requests per minute by default. Return 429 with Retry-After.',
      at: at(36),
      followUps: [{ text: 'Also exempt the /health and /metrics routes from the limiter.', at: at(14) }],
    },
    needs: { tone: 'attention', kind: 'blocked', text: `Orchestrator asks: ${QUESTION.question}`, agentId: 'main' },
    summary: { step: '2 of 5', stepText: STEPS[1], running: 2, waiting: 2, done: 1, failed: 1, files: 8, added: 120, removed: 4, minutes: 36, tokens: 0, costUsd: 6.42, contextPercent: 38 },
    plan: {
      source: 'todo',
      steps: [
        { key: '1', text: STEPS[0], status: 'done', agents: ['a3f9c21b'] },
        { key: '2', text: STEPS[1], status: 'active', agents: ['4e7d0a92', '0d5a9e47'] },
        { key: '3', text: STEPS[2], status: 'active', agents: ['b81c6f3e'] },
        { key: '4', text: STEPS[3], status: 'failed', agents: ['f26b3c18'] },
        { key: '5', text: STEPS[4], status: last, agents: [] },
      ],
    },
    agents: sampleAgents(last),
    messages: [],
    activity: [
      call(36, 'main', 'Agent', 'Explore routes: map the public routes', true, 242_000),
      call(34, 'a3f9c21b', 'Glob', 'src/routes/**/*.ts', true, 41),
      call(33, 'a3f9c21b', 'Read', 'src/app.ts', true, 12),
      call(32, 'a3f9c21b', 'Grep', 'req.user in src', true, 30),
      call(31.5, 'a3f9c21b', 'Read', 'src/middleware/auth.ts', true, 9),
      call(20, '4e7d0a92', 'Write', 'src/middleware/stores/memoryStore.ts', true, 15),
      call(18, '0d5a9e47', 'Write', 'src/middleware/stores/redisStore.ts', true, 11),
      call(12, '4e7d0a92', 'Edit', 'src/app.ts', true, 8),
      call(8, 'b81c6f3e', 'Write', 'test/rateLimit.test.ts', true, 10),
      call(7, 'f26b3c18', 'Edit', 'docs/api.md', true, 9),
      call(6.5, 'f26b3c18', 'Edit', 'CHANGELOG.md', false, 5),
      call(6, '4e7d0a92', 'Edit', 'src/config.ts', true, 7),
      call(2, 'b81c6f3e', 'Bash', 'npm test -- rateLimit', null, null),
      call(1, '0d5a9e47', 'Bash', 'npx tsc --noEmit -p .', null, null),
      call(0.5, 'main', 'AskUserQuestion', QUESTION.question, null, null),
      call(0.1, '4e7d0a92', 'Edit', 'src/middleware/rateLimit.ts', null, null),
    ],
    files: [],
    edits: [],
    changes: [],
    commits: [],
    pending: [
      { id: 'toolu_sp', agentId: 'b81c6f3e', kind: 'permission', tool: 'Bash', at: at(2), command: 'npm test -- rateLimit', description: 'Run the rate limiter tests', isAnswerable: false },
      { id: 'toolu_sq', agentId: 'main', kind: 'question', tool: 'AskUserQuestion', at: at(0.5), questions: [QUESTION], isAnswerable: true },
    ],
    acks: [],
  }
}

/** The engine for these tests: tests/world.ts, the org chart's posts and faults let go, and `sample` as web/fixtures/state.json. */
function engine(on: On, w: World, restored?: DeckSnapshot, sample = sampleState()) {
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  on('fs.read', ($, e) => (/state[.]json$/.test(e.path) ? { value: JSON.stringify(sample) } : { deny: 'no such file' }))
  world(on, w, restored)
}

/** `/deck demo` on `sample`, read and shown. */
async function sampleDeck($: Engine, on: On, sample = sampleState()) {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  engine(on, w, undefined, sample)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  return { w, clock }
}

/** The pane on `surface`, on its Plan tab. */
async function planOn($: Engine, surface: Surface = 'desktop', bodyColumns = 84) {
  const ui = await $.ui.mount(pane(surface, bodyColumns))
  await press(ui, 'tab:plan')
  return ui
}

function todo(content: string, status: 'completed' | 'in_progress' | 'pending', activeForm = content) {
  return { content, status, activeForm }
}

/** A session of this chat's own: the goal, the Orchestrator's three-step todo list, fixer at work. */
function sessionData(): DeckData {
  const data = M.emptyData(NOW - 600_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  main.model = 'claude-opus-5-5'
  M.noteGoal(data, 'goal', { text: 'Fix the login bug\nKeep the old tokens working while the new ones roll out.', origin: 'composer', at: NOW - 540_000 })
  M.noteTodo(data, main, 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: [todo('Find the bug', 'completed'), todo('Fix it and run the tests', 'in_progress', 'Fixing it'), todo('Review the diff', 'pending')] }, NOW - 500_000)
  data.agents.push(M.newAgent('agent-fixer', 'agent', 'fixer', NOW - 400_000, { type: 'general-purpose', parentId: M.MAIN, status: 'running', prompt: 'Fix the login bug', description: 'Fix the login bug' }))
  return data
}

function snapshot(data: DeckData, view: Partial<DeckSnapshot['view']> = {}): DeckSnapshot {
  return { v: M.SNAPSHOT_VERSION, data: M.copyOf(data), view: { ...M.defaultView(), ...view } }
}

/** This session restored as a reload finds it (with `view`), then `/deck <args>`; and its state as the page reads it. */
async function live($: Engine, on: On, args: string, view: Partial<DeckSnapshot['view']> = {}) {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  engine(on, w, snapshot(sessionData(), view))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  const said = await $.command.run(deck(args))
  await clock.advance(1000)
  return { w, clock, said, state: W.webStateOf(sessionData(), M.defaultView(), emptyGit(), null, NOW, 's', '/repo') }
}

/** The text of the element keyed `key`; '' when it is not drawn. */
async function textOf(ui: { find: (query: { key: string }) => Promise<{ text: string } | undefined> }, key: string): Promise<string> {
  return (await ui.find({ key }))?.text ?? ''
}

test('the Plan tab is key 3 of six: /deck plan (or /deck p) opens it; Changes, Stats and Classic follow on 4, 5 and 6', async ($, on) => {
  const { state } = await live($, on, 'plan')
  expect(M.TABS).toEqual(['dashboard', 'org', 'plan', 'changes', 'stats', 'agents'])
  expect(M.tabFor('p')).toBe('plan')
  for (const surface of [...SURFACES, 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(pane(surface))
    const tabs = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('tab:'))
    expect(tabs.map(tab => [tab.key, tab.props.label, tab.props.hotkey])).toEqual([
      ['tab:dashboard', 'Dashboard', '1'],
      ['tab:org', 'Org', '2'],
      ['tab:plan', 'Plan', '3'],
      ['tab:changes', 'Changes', '4'],
      ['tab:stats', 'Stats', '5'],
      ['tab:agents', 'Classic', '6'],
    ])
    expect((await ui.find({ key: 'tab:plan' }))?.props.dimColor).toBe(false)
    // this session's own plan: its goal and a row a step of its todo list
    expect(await textOf(ui, 'plan:goal')).toContain('Fix the login bug')
    expect(await textOf(ui, 'plan:goal')).toContain('Keep the old tokens working while the new ones roll out.')
    expect(await textOf(ui, 'plan:progress')).toContain('1/3 done · 1 in progress · 0 failed')
    expect(await textOf(ui, 'plan:progress')).toContain('from the todo list')
    const rows = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('plan:toggle:'))
    expect(rows.map(row => row.key)).toEqual(state.plan.steps.map(step => `plan:toggle:${step.key}`))
    expect(rows.map(row => row.text)).toEqual(['▸ ✓ 01 Find the bug', '▸ ◐ 02 Fix it and run the tests', '▸ ○ 03 Review the diff'])
    await ui.unmount()
  }
  // the other tabs stay where their names put them
  await $.command.run(deck('changes'))
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'tab:changes' }))?.props.dimColor).toBe(false)
  await press(ui, 'tab:plan')
  expect(await ui.find({ key: 'plan:steps' })).toBeDefined()
  await ui.unmount()
})

test('/deck plan 2 opens the Plan tab with its second step open, from another tab; a step the plan does not have is answered', async ($, on) => {
  const { state, said, w } = await live($, on, 'plan 2', { tab: 'stats' })
  expect(said.text).toBeUndefined()
  const second = state.plan.steps[1]?.key ?? ''
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'tab:plan' }))?.props.dimColor).toBe(false)
  expect(await ui.find({ key: stepRowKey(second) })).toBeDefined()
  expect(await ui.find({ key: `plan:body:${second}` })).toBeDefined()
  expect((await ui.find({ key: `plan:toggle:${second}` }))?.text).toMatch(/^▾ ◐ 02 /)
  expect(await ui.find({ key: `plan:body:${state.plan.steps[0]?.key ?? ''}` })).toBeUndefined()
  // a step the Orchestrator does itself, in hand: its item and what it is doing
  expect(await textOf(ui, `plan:body:${second}`)).toContain('does this step itself')
  expect(await textOf(ui, `plan:body:${second}`)).toContain('Fix it and run the tests  Fixing it')
  // the scroll it asks for after the redraw does not trouble the press (the kit has no ui.scroll)
  await ui.unmount()
  expect(w.toasts).toEqual([])
  expect((await $.command.run(deck('plan 9'))).text).toBe('The plan has no step 9: /deck plan shows its steps.')
  const again = await $.ui.mount(pane('desktop'))
  expect((await again.find({ key: 'tab:plan' }))?.props.dimColor).toBe(false)
  await again.unmount()
})

test('the sample`s Plan: the goal with its follow-up, "1/5 done · 2 in progress · 1 failed" and where the plan came from, its bar, and a row a step', async ($, on) => {
  await sampleDeck($, on)
  for (const surface of SURFACES) {
    const ui = await planOn($, surface)
    const goal = await textOf(ui, 'plan:goal')
    expect(goal).toContain('GOAL')
    expect(goal).toContain('36m')
    expect((await ui.find({ type: 'Text', text: 'Add per-user rate limiting to the public API' }))?.props).toMatchObject({ bold: true, color: P.text })
    expect(goal).toContain('Use a sliding window, 100 requests per minute by default. Return 429 with Retry-After.')
    expect(goal).toContain('Also exempt the /health and /metrics routes from the limiter.')
    expect(goal).toContain('14m')
    // a goal this short has nothing folded
    expect(await ui.find({ key: 'plan:goal:more' })).toBeUndefined()

    const progress = await textOf(ui, 'plan:progress')
    expect(progress).toContain('1/5 done · 2 in progress · 1 failed')
    expect((await ui.find({ type: 'Text', text: ' from the todo list ' }))?.props).toMatchObject({ color: P.muted, backgroundColor: P.chip })
    expect((await ui.find({ type: 'Text', text: /^1 failed$/ }))?.props.color).toBe(P.failText)
    const bar = (await ui.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Plan:'))
    if (surface === 'desktop') expect(bar?.props.alt).toBe('Plan: 1 of 5 steps done')
    else expect(bar).toBeUndefined()

    // a row a step: its glyph, number and words, then who is on it and its status in a word
    const rows = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('plan:toggle:'))
    expect(rows.map(row => row.text)).toEqual([`▸ ✓ 01 ${STEPS[0]}`, `▸ ◐ 02 ${STEPS[1]}`, `▸ ◐ 03 ${STEPS[2]}`, `▸ ✕ 04 ${STEPS[3]}`, `▸ ○ 05 ${STEPS[4]}`])
    expect(rows.every(row => row.props.plain === true)).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^✓$/ }))?.props.color).toBe(P.doneText)
    expect((await ui.find({ type: 'Text', text: /^✕$/ }))?.props.color).toBe(P.failText)
    expect((await ui.findAll({ type: 'Text', text: /^◐$/ })).map(one => one.props.color)).toEqual([P.runText, P.runText])
    expect((await ui.find({ type: 'Text', text: /^Write the sliding-window limiter/ }))?.props).toMatchObject({ bold: true, color: P.text })
    const words = await Promise.all(['1', '2', '3', '4', '5'].map(key => textOf(ui, `plan:row:${key}`)))
    const said = ['Done', 'In progress', 'In progress', 'Failed', 'Pending']
    words.forEach((row, i) => expect(row.endsWith(said[i] ?? '?')).toBe(true))
    expect((await ui.findAll({ type: 'Text', text: /^In progress$/ })).map(one => one.props.color)).toEqual([P.runText, P.runText])
    // Tests waits on you: its step says so
    expect(words[2]).toContain(' needs you ')
    expect(words.filter(row => row.includes('needs you'))).toHaveLength(1)
    // the agents on a step: avatars where Svg draws, dots on the terminal; a dash where the Orchestrator does it itself
    const faces = (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).endsWith('avatar')).map(svg => svg.props.alt)
    if (surface === 'desktop') expect(faces).toEqual(["Explore routes's avatar", "Limiter's avatar", "Redis store's avatar", "Tests's avatar", "Docs's avatar"])
    else expect(faces).toEqual([])
    expect(words[4]).toContain('—')
    // folded, every one
    expect((await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('plan:body:'))).toEqual([])
    await ui.unmount()
  }
})

test('a press on a step`s row opens it under the row and another folds it; what is open stays through redraws, other tabs and an agent`s page', async ($, on) => {
  await sampleDeck($, on)
  const ui = await planOn($)
  await press(ui, 'plan:toggle:2')
  expect((await ui.find({ key: 'plan:toggle:2' }))?.text).toMatch(/^▾ ◐ 02 /)
  const cards = (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('plan:agent:'))
  expect(cards).toEqual(['plan:agent:2:4e7d0a92', 'plan:agent:2:0d5a9e47'])
  // its row lights under the pointer; the row is the press
  const row = await ui.find({ key: 'plan:row:2' })
  expect(row?.props.hover).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"hover":{"backgroundColor"')
  // a redraw, another tab and back, an agent page and Back: still open
  await ui.redraw()
  expect(await ui.find({ key: 'plan:body:2' })).toBeDefined()
  await press(ui, 'tab:dashboard')
  expect(await ui.find({ key: 'plan:body:2' })).toBeUndefined()
  await press(ui, 'tab:plan')
  expect(await ui.find({ key: 'plan:body:2' })).toBeDefined()
  await press(ui, 'plan:open:2:4e7d0a92')
  expect((await ui.find({ key: 'page:back' }))?.props.label).toBe('← Plan')
  await press(ui, 'page:back')
  expect((await ui.find({ key: 'tab:plan' }))?.props.dimColor).toBe(false)
  expect(await ui.find({ key: 'plan:body:2' })).toBeDefined()
  // two open at once; a second press folds one
  await press(ui, 'plan:toggle:4')
  expect(await ui.find({ key: 'plan:body:4' })).toBeDefined()
  await press(ui, 'plan:toggle:2')
  expect(await ui.find({ key: 'plan:body:2' })).toBeUndefined()
  expect((await ui.find({ key: 'plan:toggle:2' }))?.text).toMatch(/^▸ /)
  expect(await ui.find({ key: 'plan:body:4' })).toBeDefined()
  await ui.unmount()
})

test('what the Plan tab has open is kept in the deck`s view: a reload of the mod opens the same steps and texts again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  const saved: DeckSnapshot[] = []
  on('state.set', { plugin: 'agent-deck', key: 'snapshot' }, ($, e) => {
    saved.push(JSON.parse(JSON.stringify(e.value)) as DeckSnapshot)
    return { value: { isSet: true as const, version: saved.length } }
  })
  engine(on, w, snapshot(M.emptyData(NOW), { tab: 'plan', isDemo: true, planOpen: ['step:1', 'result:a3f9c21b', 'step:3'] }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.advance(1000)
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'demo:back' }))?.props.label).toBe('Back to this chat')
  expect((await ui.find({ key: 'tab:plan' }))?.props.dimColor).toBe(false)
  expect(await ui.find({ key: 'plan:body:1' })).toBeDefined()
  expect(await ui.find({ key: 'plan:body:3' })).toBeDefined()
  expect(await ui.find({ key: 'plan:body:2' })).toBeUndefined()
  expect((await ui.find({ key: 'plan:more:1:a3f9c21b' }))?.props.label).toBe('Show less')
  // a fold is written back for the next reload
  await press(ui, 'plan:toggle:3')
  await clock.advance(2000)
  expect(saved[saved.length - 1]?.view.planOpen).toEqual(['step:1', 'result:a3f9c21b'])
  await ui.unmount()
})

test('the view keeps the Plan tab`s open ids as strings, each once, the newest hundred; planOpenWith opens, folds and toggles one', () => {
  expect(M.defaultView().planOpen).toEqual([])
  expect(M.healView({ planOpen: ['step:1', 7, '', 'goal', 'step:1', null, 'result:x'] }).planOpen).toEqual(['step:1', 'goal', 'result:x'])
  expect(M.healView({ planOpen: 'step:1' }).planOpen).toEqual([])
  const many = Array.from({ length: 130 }, (_, i) => `step:${i}`)
  expect(M.healView({ planOpen: many }).planOpen).toEqual(many.slice(-100))
  expect(M.planOpenWith([], 'step:2')).toEqual(['step:2'])
  expect(M.planOpenWith(['step:2', 'goal'], 'step:2')).toEqual(['goal'])
  expect(M.planOpenWith(['step:2', 'goal'], 'step:2', true)).toEqual(['goal', 'step:2'])
  expect(M.planOpenWith(['goal'], 'step:2', false)).toEqual(['goal'])
  expect(M.planOpenWith(['goal'], '')).toEqual(['goal'])
  expect(M.planOpenWith(many, 'step:new')).toHaveLength(100)
})

test('an open step: a card an agent, the one it started under it, each with its face, name, type, pill, now line, checklist, last three calls, files and the ways to its page', async ($, on) => {
  await sampleDeck($, on)
  for (const surface of SURFACES) {
    const ui = await planOn($, surface)
    if (!(await ui.find({ key: 'plan:body:2' }))) await press(ui, 'plan:toggle:2')
    const limiter = await ui.find({ key: 'plan:agent:2:4e7d0a92' })
    expect(limiter?.props).toMatchObject({ borderStyle: 'round', borderColor: TONE.running.edge })
    expect(limiter?.props.marginLeft).toBe(0)
    const text = limiter?.text ?? ''
    expect((await ui.find({ key: 'plan:name:2:4e7d0a92' }))?.props).toMatchObject({ label: 'Limiter', plain: true })
    expect(text).toContain('general-purpose')
    expect(text).toContain(' running ')
    expect(text).toContain('Edit src/middleware/rateLimit.ts')
    // its checklist: a meter and three of five
    expect(text).toContain('3/5')
    // its last three calls, newest first, as the Dashboard words them
    const calls = ['edited src/middleware/rateLimit.ts', 'running', 'now', 'edited src/config.ts', '7ms', '6m', 'edited src/app.ts', '8ms', '12m']
    let from = 0
    for (const part of calls) {
      const found = text.indexOf(part, from)
      expect(found >= 0, `${part} after ${from} in ${text}`).toBe(true)
      from = found + part.length
    }
    expect(text).not.toContain('wrote src/middleware/stores/memoryStore.ts')
    // the files it touched, five by name, then how many more
    for (const name of ['rateLimit.ts', 'memoryStore.ts', 'app.ts', 'config.ts', 'index.ts']) expect(text).toContain(` ${name} `)
    expect(text).toContain('+1 more')
    expect(text).not.toContain('types.ts')
    expect((await ui.find({ key: 'plan:open:2:4e7d0a92' }))?.props).toMatchObject({ label: 'Open agent →', plain: true })
    expect((await ui.find({ key: 'plan:talk:2:4e7d0a92' }))?.props).toMatchObject({ label: 'Talk →', plain: true })
    // the agent it started: under it, indented, saying who started it; on the step once though the plan names it too
    const redis = await ui.find({ key: 'plan:agent:2:0d5a9e47' })
    expect(redis?.props.marginLeft).toBe(2)
    expect(redis?.text).toContain('general-purpose · started by Limiter')
    expect(redis?.text).toContain('Type-checking: npx tsc --noEmit -p .')
    expect(redis?.text).toContain('2/3')
    expect((await ui.findAll({ type: 'Box' })).filter(box => box.key === 'plan:agent:2:0d5a9e47')).toHaveLength(1)
    // faces where Svg draws, with the status dot; nothing of a result for agents still at work
    const faces = (await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.alt === "Limiter's avatar")
    if (surface === 'desktop') expect(faces.map(face => face.props.width)).toEqual([20, 22])
    expect(text).not.toContain('RESULT')
    await ui.unmount()
  }
})

test('every step of the sample opens and is filled: a done agent`s report folded with Show more, a failed one`s head, a permission waiting on you, the Orchestrator`s own step', async ($, on) => {
  const { w } = await sampleDeck($, on)
  const ui = await planOn($)
  for (const key of ['1', '2', '3', '4', '5']) await press(ui, `plan:toggle:${key}`)
  for (const key of ['1', '2', '3', '4', '5']) expect((await textOf(ui, `plan:body:${key}`)).length > 40, `step ${key}`).toBe(true)

  // 1: Explore routes, done: its report folded to four lines; Show more opens the rest, Show less folds it again
  const explore = await textOf(ui, 'plan:agent:1:a3f9c21b')
  expect(explore).toContain(' done ')
  expect(explore).toContain('Found 14 public routes under /v1; no limiter in place')
  expect(explore).toContain('4/4')
  expect(explore).toContain('read src/middleware/auth.ts')
  expect(explore).toContain('RESULT')
  const report = (await ui.findAll({ type: 'Markdown' })).find(md => String(md.props.text).startsWith('Found 14 public routes under /v1, all mounted'))
  expect(String(report?.props.text)).toContain('- customers.ts')
  expect(String(report?.props.text)).not.toContain('No rate limiting anywhere in the chain.')
  expect((await ui.find({ key: 'plan:more:1:a3f9c21b' }))?.props).toMatchObject({ label: 'Show more', plain: true })
  await press(ui, 'plan:more:1:a3f9c21b')
  expect((await ui.find({ type: 'Markdown', text: 'No rate limiting anywhere in the chain.' }))?.props.text).toBe(EXPLORE_RESULT)
  expect((await ui.find({ key: 'plan:more:1:a3f9c21b' }))?.props.label).toBe('Show less')
  await press(ui, 'plan:more:1:a3f9c21b')
  expect(await ui.find({ type: 'Markdown', text: 'No rate limiting anywhere in the chain.' })).toBeUndefined()

  // 3: Tests waits on your OK: the permission card, as the Dashboard draws it, inside its card (no Open: its page is a press away)
  const tests = await ui.find({ key: 'plan:agent:3:b81c6f3e' })
  expect(tests?.props.borderColor).toBe(TONE.waiting.edge)
  expect(tests?.text).toContain('Needs your OK to run npm test -- rateLimit')
  expect(tests?.text).toContain('Tests needs your OK to run npm test -- rateLimit')
  expect(tests?.text).toContain('Allow or deny it in Claude Code.')
  expect(await ui.find({ key: 'needs:toolu_sp' })).toBeDefined()
  expect(await ui.find({ key: 'needs:open:toolu_sp' })).toBeUndefined()

  // 4: Docs failed: its head says so, a short report shows whole, with no Show more
  const docs = await textOf(ui, 'plan:agent:4:f26b3c18')
  expect(docs).toContain('RESULT · FAILED')
  expect((await ui.find({ type: 'Text', text: /^RESULT · FAILED$/ }))?.props.color).toBe(P.failText)
  expect(docs).toContain(DOCS_RESULT)
  expect(docs).toContain('failed')
  expect(await ui.find({ key: 'plan:more:4:f26b3c18' })).toBeUndefined()

  // 5: no agent on it: the Orchestrator takes it itself, its checklist item for it, not started yet; its question is not on a step not in hand
  const own = await textOf(ui, 'plan:agent:5:main')
  expect(own).toContain('Orchestrator')
  expect(own).toContain('takes this step itself')
  expect(own).toContain(`○${STEPS[4]}`)
  expect(own).toContain('Not started yet.')
  expect(await ui.find({ key: 'plan:open:5:main' })).toBeDefined()
  expect(await ui.find({ key: 'needs:toolu_sq' })).toBeUndefined()
  expect(w.toasts).toEqual([])
  await ui.unmount()
})

test('a step the Orchestrator does itself, in hand: its item and its words, its last calls, and its question, answered here in the sample alone', async ($, on) => {
  const { w } = await sampleDeck($, on, sampleState(true))
  const ui = await planOn($)
  expect(await textOf(ui, 'plan:row:5')).toContain('needs you')
  await press(ui, 'plan:toggle:5')
  const own = await textOf(ui, 'plan:agent:5:main')
  expect(own).toContain('does this step itself')
  expect(own).toContain(`◐${STEPS[4]}  Reading the diff`)
  expect((await ui.findAll({ type: 'Text', text: /^◐$/ })).map(one => one.props.color)).toContain(P.waitText)
  // its calls, newest first: the question it asks (cut to the card), what it started
  expect(own).toContain('asked you: Where should the rate limit entry go')
  expect(own).toContain('waiting')
  expect(own).toContain('started Explore routes: map the public routes')
  // the question, its options a press each, inside the card
  expect((await ui.find({ key: 'needs:toolu_sq' }))?.text).toContain('Orchestrator asks you')
  await press(ui, 'answer:toolu_sq:0:1')
  expect(w.toasts).toContain('Sample data: you answered Leave the changelog alone. Nothing was sent to Claude.')
  expect(await ui.find({ key: 'needs:toolu_sq' })).toBeUndefined()
  expect(await textOf(ui, 'plan:row:5')).not.toContain('needs you')
  await ui.unmount()
})

test('Open agent → opens the agent`s page and Talk → opens it on Talk; a name opens it too; Back returns to the Plan, the step still open', async ($, on) => {
  const { w } = await sampleDeck($, on)
  const ui = await planOn($)
  await press(ui, 'plan:toggle:3')
  await press(ui, 'plan:open:3:b81c6f3e')
  expect((await ui.find({ key: 'page:head' }))?.text).toContain('Tests')
  expect((await ui.find({ key: 'page:back' }))?.props.label).toBe('← Plan')
  await press(ui, 'page:back')
  expect(await ui.find({ key: 'plan:body:3' })).toBeDefined()

  // Talk →: the page on its Talk, the pane scrolled there (the Desktop's to show)
  expect((await ui.find({ key: 'plan:talk:3:b81c6f3e' }))?.props.label).toBe('Talk →')
  await press(ui, 'plan:talk:3:b81c6f3e')
  expect((await ui.find({ key: 'page:head' }))?.text).toContain('Tests')
  expect((await ui.find({ key: 'detail:chat' }))?.props.dimColor).toBe(false)
  expect((await ui.find({ key: 'detail:edits' }))?.props.dimColor).toBe(true)
  await press(ui, 'page:back')

  // a sub-agent's name, and the Orchestrator's Talk from its own step
  await press(ui, 'plan:toggle:2')
  await press(ui, 'plan:name:2:0d5a9e47')
  expect((await ui.find({ key: 'page:head' }))?.text).toContain('Redis store')
  await press(ui, 'page:back')
  await press(ui, 'plan:toggle:5')
  await press(ui, 'plan:talk:5:main')
  expect((await ui.find({ key: 'page:head' }))?.text).toContain('Orchestrator')
  expect((await ui.find({ key: 'detail:chat' }))?.props.dimColor).toBe(false)
  await press(ui, 'page:back')
  expect((await ui.find({ key: 'tab:plan' }))?.props.dimColor).toBe(false)
  expect(w.toasts).toEqual([])
  await ui.unmount()
})

test('the layout keeps to the pane: at 68 cells a long step`s words are cut on its one-line row and shown whole when it opens; at 84 they fit', async ($, on) => {
  await sampleDeck($, on)
  for (const [body, isCut] of [
    [68, true],
    [84, false],
  ] as const) {
    const ui = await planOn($, 'desktop', body)
    const row = (await ui.find({ key: 'plan:toggle:2' }))?.text ?? ''
    expect(row.endsWith('…')).toBe(isCut)
    expect(Array.from(row).length <= body - 1 - 4 - 1 - 4 - 1 - 11).toBe(true)
    if (!(await ui.find({ key: 'plan:body:2' }))) await press(ui, 'plan:toggle:2')
    const whole = (await ui.find({ key: 'plan:body:2' }))?.children[0] as { type?: string; children?: unknown[] } | undefined
    if (isCut) expect(whole?.children).toEqual([STEPS[1]])
    else expect(whole?.type).toBe('Box')
    await ui.unmount()
  }
})

/** Actions that do nothing, for the tab drawn by itself. */
function inert(): DashActions {
  return new Proxy({}, { get: () => () => undefined }) as DashActions
}

/** A plan of thirty steps and eighty finished agents, each with a long report; `isHeavy` gives each long lines, paths and files too. */
function bigState(isHeavy: boolean): W.WebState {
  const word = isHeavy ? 'a-much-longer-name-for-a-file-in-a-deep-folder' : 'x'
  const report = `${'A long report line about what was found and changed in this part of the code.\n'.repeat(50)}The end.`
  const said = isHeavy ? 'Finished the work it was given, and says so at length in a line that goes on for a while. '.repeat(3) : 'Finished'
  const agents = Array.from({ length: 80 }, (_, i) =>
    agentRow({ id: `agent-${i}`, label: `Agent ${i}`, status: 'done', endedAt: at(1), now: said, result: report, checklist: checklist([['One', 'done']]), files: [1, 2, 3, 4, 5].map(n => `src/${word}/${word}-${n}.ts`) }),
  )
  return {
    ...sampleState(),
    goal: null,
    agents,
    pending: [],
    activity: agents.flatMap(agent => [3, 2, 1].map(n => call(n, agent.id, 'Read', isHeavy ? `src/${'deep/'.repeat(8)}file-${n}.ts` : 'a.ts', true, 4))),
    plan: { source: 'implicit', steps: agents.slice(0, 30).map((agent, i) => ({ key: `agent:${agent.id}`, text: `Step ${i + 1}`, status: 'done' as const, agents: [agent.id, ...(i < 25 ? [`agent-${i + 30}`, `agent-${i + 55}`] : [])] })) },
  }
}

/** How many elements of a drawn tree pass `test`. */
function countOf(tree: unknown, test: (node: { type?: string; props?: Record<string, unknown> }) => boolean): number {
  if (!tree || typeof tree !== 'object') return 0
  if (Array.isArray(tree)) return tree.reduce((sum: number, one) => sum + countOf(one, test), 0)
  const node = tree as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  return (test(node) ? 1 : 0) + countOf(node.children ?? [], test)
}

test('a plan too big to draw whole is drawn leaner, inside the host`s bounds: its reports folded first, then only the three steps opened last, saying so', async ($, on) => {
  mock.clock(on, { now: NOW })
  const trees: Record<'light' | 'heavy', RenderElement | undefined> = { light: undefined, heavy: undefined }
  on('ui.render', { component: 'Pane', requestId: 'plan-probe' }, ($, e) => {
    const ui = $.ui.resolve(e)
    const kit: Kit = { surface: e.surface, Box: ui.Box, Text: ui.Text, Button: ui.Button, Code: ui.Code, Markdown: ui.Markdown, columns: 83, ...('Svg' in ui ? { Svg: ui.Svg } : {}) }
    const draw = (isHeavy: boolean) => {
      const state = bigState(isHeavy)
      // every step and every report opened, the step of agent-7 last
      const steps = state.plan.steps.map(step => `step:${step.key}`).filter(id => id !== 'step:agent:agent-7')
      const open = [...steps, ...state.agents.map(agent => `result:${agent.id}`), 'step:agent:agent-7']
      return planTab(kit, state, { ...M.defaultView(), tab: 'plan', planOpen: open }, inert(), NOW)
    }
    const light = draw(false)
    trees.light = light
    trees.heavy = draw(true)
    return light
  })
  engine(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ ...pane('desktop'), requestId: 'plan-probe' })
  for (const [name, tree] of Object.entries(trees)) {
    if (!tree) throw new Error(`the ${name} plan was not drawn`)
    const size = treeSize(tree)
    expect(size.chars <= TREE_BOUNDS.chars && size.nodes <= TREE_BOUNDS.nodes && size.depth <= TREE_BOUNDS.depth, `${name}: ${JSON.stringify(size)}`).toBe(true)
    // no report whole, and no Show more for one the drawing could not open
    expect(countOf(tree, node => node.type === 'Markdown' && String(node.props?.text).endsWith('The end.'))).toBe(0)
    expect(countOf(tree, node => String(node.props?.key ?? '').startsWith('plan:more:'))).toBe(0)
  }
  const bodies = (tree: RenderElement | undefined) => countOf(tree, node => String(node.props?.key ?? '').startsWith('plan:body:'))
  const notes = (tree: RenderElement | undefined) => countOf(tree, node => node.type === 'Text' && JSON.stringify(node).includes('steps opened last stay open, to fit the pane'))
  // light: folding the reports is enough, every step stays open
  expect(bodies(trees.light)).toBe(30)
  expect(notes(trees.light)).toBe(0)
  // heavy: only the three opened last, agent-7's among them, and a line saying why
  expect(bodies(trees.heavy)).toBe(3)
  expect(countOf(trees.heavy, node => node.props?.key === 'plan:body:agent:agent-7')).toBe(1)
  expect(notes(trees.heavy)).toBe(1)
  expect(await ui.find({ key: 'plan:steps' })).toBeDefined()
  await ui.unmount()
})
