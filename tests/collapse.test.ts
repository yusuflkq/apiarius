/**
 * Folding sections: the Dashboard's goal, agents, figures, recent activity
 * and files, an agent page's Task and Checklist, the Plan tab's goal. A
 * section's head is one plain Button ("▾ AGENTS 3"; "▸ AGENTS 3" folded),
 * and a folded section shows its head and one dim line of what it holds.
 * What is folded lives in the deck's view (`DeckView.collapsed`), so it
 * stays through redraws, live updates and a reload of the mod.
 *
 * tests/world.ts answers `ui.invalidate` itself, so a mounted pane is drawn
 * again by `redraw`, after a press that changed what it shows.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import { FOLD, activityFoldOf, agentsFoldOf, figuresFoldOf, filesFoldOf, goalFoldOf } from '../hooks/ui/dash/dashModel'
import { foldLabel } from '../hooks/ui/dash/parts'
import * as W from '../hooks/web'
import type { DeckData, DeckSnapshot } from '../types'
import { deck, newWorld, NOW, world, type World } from './world'

const SURFACES = ['terminal', 'desktop'] as const

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane(surface: 'terminal' | 'desktop', bodyColumns = 96) {
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

const PATCH = ['@@ -1,3 +1,3 @@', ' const a = 1', '-const b = 2', '+const b = 3', ' export { a, b }'].join('\n')

function todo(content: string, status: 'completed' | 'in_progress' | 'pending', activeForm = content) {
  return { content, status, activeForm }
}

/**
 * A session under way: you asked to fix a login bug; the Orchestrator keeps
 * a three-step todo list; fixer (on step two) edited src/auth.ts and runs the
 * tests; helper, which fixer started, edited the same file while fixer did
 * (so it is shared) and finished.
 */
function sessionData(): DeckData {
  const data = M.emptyData(NOW - 600_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  main.model = 'claude-opus-5-5'
  M.noteGoal(data, 'goal', { text: 'Fix the login bug\nKeep the old tokens working while the new ones roll out.', origin: 'composer', at: NOW - 540_000 })
  M.noteTodo(data, main, 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: [todo('Find the bug', 'completed'), todo('Fix it and run the tests', 'in_progress', 'Fixing it'), todo('Review the diff', 'pending')] }, NOW - 500_000)
  const fixer = M.newAgent('agent-fixer', 'agent', 'fixer', NOW - 400_000, {
    type: 'general-purpose',
    parentId: M.MAIN,
    status: 'running',
    prompt: 'Fix the login bug in src/auth.ts and run the tests',
    description: 'Fix the login bug',
    model: 'claude-haiku-4-5-20251001',
  })
  data.agents.push(fixer)
  const helper = M.newAgent('agent-helper', 'agent', 'helper', NOW - 300_000, { type: 'Explore', parentId: fixer.id, status: 'completed', endedAt: NOW - 200_000, description: 'Find the auth module', answer: 'It is src/auth.ts' })
  data.agents.push(helper)
  M.addEdit(data, helper, { id: 'e0', agent: helper.id, tool: 'Edit', path: 'src/auth.ts', abs: '/repo/src/auth.ts', at: NOW - 250_000, added: 2, removed: 0, patch: PATCH, isNew: false })
  M.addEdit(data, fixer, { id: 'e0b', agent: fixer.id, tool: 'Edit', path: 'src/auth.ts', abs: '/repo/src/auth.ts', at: NOW - 240_000, added: 1, removed: 0, patch: PATCH, isNew: false })
  M.addEdit(data, fixer, { id: 'e1', agent: fixer.id, tool: 'Edit', path: 'src/auth.ts', abs: '/repo/src/auth.ts', at: NOW - 60_000, added: 1, removed: 1, patch: PATCH, isNew: false })
  M.beginTool(data, fixer, M.activityOf('t1', 'Bash', { command: 'npm test', description: 'Run the unit tests' }, '/repo', NOW - 20_000))
  return data
}

function snapshot(data: DeckData, view: Partial<DeckSnapshot['view']> = {}): DeckSnapshot {
  return { v: M.SNAPSHOT_VERSION, data: M.copyOf(data), view: { ...M.defaultView(), ...view } }
}

/** The engine for these tests: tests/world.ts, plus the org chart Client's posts and faults. */
function engine(on: On, w: World, restored?: DeckSnapshot) {
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  world(on, w, restored)
}

/**
 * The session above, restored as a reload finds it (with `view`), and the
 * pane opened with /deck: the snapshots it writes land in `saved`, and
 * `redraws.n` counts the redraws it asks for (`ui.invalidate`).
 */
async function opened($: Engine, on: On, view: Partial<DeckSnapshot['view']> = {}, saved: DeckSnapshot[] = []) {
  const clock = mock.clock(on, { now: NOW })
  on('state.set', { plugin: 'agent-deck', key: 'snapshot' }, ($, e) => {
    saved.push(JSON.parse(JSON.stringify(e.value)) as DeckSnapshot)
    return { value: { isSet: true as const, version: saved.length } }
  })
  // tests/world.ts answers ui.invalidate; here it is answered and counted instead
  const beneath = ((name: string, ...rest: unknown[]) => (name === 'ui.invalidate' ? undefined : (on as unknown as (...args: unknown[]) => unknown)(name, ...rest))) as unknown as On
  engine(beneath, newWorld(), snapshot(sessionData(), view))
  const redraws = { n: 0 }
  on('ui.invalidate', () => {
    redraws.n += 1
    return { value: undefined }
  })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await clock.advance(1000)
  return { clock, redraws }
}

/** The state the Dashboard draws for the session above, as the page reads it. */
function sessionState(): W.WebState {
  return W.webStateOf(sessionData(), M.defaultView(), emptyGit(), null, NOW, 's', '/repo')
}

/** The labels of the drawing's fold heads, by key. */
async function heads(ui: { findAll: (query: { type: string }) => Promise<{ key?: string; props: Record<string, unknown> }[]> }): Promise<[string, unknown][]> {
  return (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('fold:')).map(button => [button.key ?? '', button.props.label])
}

test('the view keeps the folded sections as strings, each once, the newest fifty; collapsedWith folds, opens and toggles one; a head reads "▾ AGENTS 7"', () => {
  expect(M.defaultView().collapsed).toEqual([])
  expect(M.healView({ collapsed: ['dash:agents', 7, '', 'dash:files', 'dash:agents', null] }).collapsed).toEqual(['dash:agents', 'dash:files'])
  expect(M.healView({ collapsed: 'dash:agents' }).collapsed).toEqual([])
  expect(M.healView({ tab: 'plan' }).collapsed).toEqual([])
  const many = Array.from({ length: 70 }, (_, i) => `section:${i}`)
  expect(M.healView({ collapsed: many }).collapsed).toEqual(many.slice(-50))

  expect(M.collapsedWith([], FOLD.agents)).toEqual(['dash:agents'])
  expect(M.collapsedWith(['dash:agents', 'dash:files'], FOLD.agents)).toEqual(['dash:files'])
  expect(M.collapsedWith(['dash:agents'], FOLD.files, true)).toEqual(['dash:agents', 'dash:files'])
  expect(M.collapsedWith(['dash:agents'], FOLD.agents, true)).toEqual(['dash:agents'])
  expect(M.collapsedWith(['dash:agents'], FOLD.files, false)).toEqual(['dash:agents'])
  expect(M.collapsedWith(['dash:agents'], '')).toEqual(['dash:agents'])
  expect(M.collapsedWith(many, 'new')).toHaveLength(50)

  expect(Object.values(FOLD)).toEqual(['dash:goal', 'dash:agents', 'dash:figures', 'dash:activity', 'dash:files', 'page:task', 'page:checklist', 'plan:goal'])
  expect(foldLabel('Agents', 7, true)).toBe('▾ AGENTS 7')
  expect(foldLabel('Agents', 7, false)).toBe('▸ AGENTS 7')
  expect(foldLabel('Recent activity', null, false)).toBe('▸ RECENT ACTIVITY')
})

test('a folded section`s one line says what it holds: the goal and its step, how the agents stand, the figures, the newest call, the files shared and their lines', () => {
  const state = sessionState()
  expect(goalFoldOf(state)).toBe('Fix the login bug · Step 2 of 3')
  expect(agentsFoldOf(state)).toBe('2 running · 1 done')
  expect(figuresFoldOf(state)).toBe('2 running · 1/3 steps · — · 0 waiting on you')
  expect(activityFoldOf(state, NOW)).toBe('1 running · fixer ran Run the unit tests · now')
  expect(filesFoldOf(state)).toBe('1 shared · 1 live · +4 −1')

  // before anything happens: each says what will be there
  const empty = W.webStateOf(M.emptyData(NOW), M.defaultView(), emptyGit(), null, NOW, 's', '/repo')
  expect(goalFoldOf(empty)).toBe('No goal yet')
  expect(figuresFoldOf(empty)).toBe('0 running · no plan yet · — · 0 waiting on you')
  expect(activityFoldOf(empty, NOW)).toBe('No tool calls yet')
  expect(filesFoldOf(empty)).toBe('No files touched yet')
  expect(agentsFoldOf({ ...empty, agents: [] })).toBe('none yet')
})

test('each Dashboard section`s head is one plain Button, "▾ AGENTS 3"; a press folds it at once to the head and one dim line, another opens it again, the others staying open', async ($, on) => {
  const { redraws } = await opened($, on)
  const state = sessionState()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await heads(ui)).toEqual([
      ['fold:dash:goal', '▾ GOAL'],
      ['fold:dash:agents', '▾ AGENTS 3'],
      ['fold:dash:figures', '▾ FIGURES'],
      ['fold:dash:activity', '▾ RECENT ACTIVITY'],
      ['fold:dash:files', '▾ FILES 1'],
    ])
    // a desktop draws the label alone, dim; the terminal its Text, the title bold in the heading's grey
    for (const head of (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('fold:'))) expect(head.props).toMatchObject({ plain: true, dimColor: surface === 'desktop' })
    expect((await ui.find({ type: 'Text', text: 'AGENTS' }))?.props.bold).toBe(true)

    // the agents folded, drawn again at once: the head, how they stand, the way to the org chart; no cards
    redraws.n = 0
    await ui.press({ key: 'fold:dash:agents' })
    expect(redraws.n).toBeGreaterThan(0)
    await ui.redraw()
    expect((await ui.find({ key: 'fold:dash:agents' }))?.props.label).toBe('▸ AGENTS 3')
    expect((await ui.find({ key: 'dash:agents' }))?.text).toBe('▸ AGENTS 3· 2 running · 1 doneOrg chart →')
    expect(await ui.find({ type: 'Text', text: `· ${agentsFoldOf(state)}` })).toBeDefined()
    expect(await ui.find({ key: 'card:main' })).toBeUndefined()
    // the rest stay open
    for (const key of ['dash:goal', 'dash:kpis', 'dash:calls', 'dash:filelist']) expect(await ui.find({ key })).toBeDefined()
    await press(ui, 'fold:dash:agents')
    expect((await ui.find({ key: 'fold:dash:agents' }))?.props.label).toBe('▾ AGENTS 3')
    expect(await ui.find({ key: 'card:main' })).toBeDefined()

    // every other section the same way: its body goes, its line shows, then it opens again
    const others: [string, string, string, RegExp][] = [
      [FOLD.goal, 'dash:goal', `· ${goalFoldOf(state)}`, /^▸ GOAL$/],
      [FOLD.figures, 'dash:kpis', '', /^▸ FIGURES$/],
      [FOLD.activity, 'dash:calls', `· ${activityFoldOf(state, NOW)}`, /^▸ RECENT ACTIVITY$/],
      [FOLD.files, 'dash:filelist', `· ${filesFoldOf(state)}`, /^▸ FILES 1$/],
    ]
    for (const [id, body, line, label] of others) {
      await press(ui, `fold:${id}`)
      expect(String((await ui.find({ key: `fold:${id}` }))?.props.label)).toMatch(label)
      expect(await ui.find({ key: body })).toBeUndefined()
      if (line) expect(await ui.find({ type: 'Text', text: line })).toBeDefined()
      await press(ui, `fold:${id}`)
      expect(await ui.find({ key: body })).toBeDefined()
    }
    // the figures' line: each one's value in a few words (the spend is this session's)
    await press(ui, `fold:${FOLD.figures}`)
    expect(await ui.find({ type: 'Text', text: /^· 2 running · 1\/3 steps · \S+ · 0 waiting on you$/ })).toBeDefined()
    await press(ui, `fold:${FOLD.figures}`)
    await ui.unmount()
  }
})

test('side by side from 120 cells, Files folds on its own: Recent activity keeps its list, each keeps half the pane', async ($, on) => {
  await opened($, on, { collapsed: [FOLD.files] })
  const ui = await $.ui.mount(pane('desktop', 130))
  const half = Math.floor((129 - 2) / 2)
  expect((await ui.find({ key: 'dash:files' }))?.props.width).toBe(half)
  expect((await ui.find({ key: 'dash:activity' }))?.props.width).toBe(half)
  expect(await ui.find({ key: 'dash:filelist' })).toBeUndefined()
  expect(await ui.find({ key: 'dash:calls' })).toBeDefined()
  expect((await ui.find({ key: 'fold:dash:files' }))?.props.label).toBe('▸ FILES 1')
  await ui.unmount()
})

test('what is folded is kept in the deck`s view: a reload of the mod folds the same sections, live updates keep them, and each new fold is written back', async ($, on) => {
  const saved: DeckSnapshot[] = []
  const { clock } = await opened($, on, { collapsed: [FOLD.files] }, saved)
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'fold:dash:files' }))?.props.label).toBe('▸ FILES 1')
  expect(await ui.find({ key: 'dash:filelist' })).toBeUndefined()
  expect(await ui.find({ key: 'card:main' })).toBeDefined()

  // a fold of another section, then work goes on: both stay folded, their lines follow the session
  await press(ui, 'fold:dash:agents')
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/app.ts' })
  await clock.advance(5000)
  await ui.redraw()
  expect((await ui.find({ key: 'fold:dash:files' }))?.props.label).toBe('▸ FILES 1')
  expect((await ui.find({ key: 'fold:dash:agents' }))?.props.label).toBe('▸ AGENTS 3')
  expect(await ui.find({ key: 'card:main' })).toBeUndefined()
  expect(await ui.find({ key: 'dash:filelist' })).toBeUndefined()
  expect(await ui.find({ key: 'dash:calls' })).toBeDefined()

  // written back for the next reload, the newest last
  expect(saved[saved.length - 1]?.view.collapsed).toEqual([FOLD.files, FOLD.agents])
  await press(ui, 'fold:dash:files')
  await clock.advance(2000)
  expect(saved[saved.length - 1]?.view.collapsed).toEqual([FOLD.agents])
  expect(await ui.find({ key: 'dash:filelist' })).toBeDefined()
  await ui.unmount()
})

test('an agent page`s Task and Checklist fold by their titles, "▾ Task", to one dim line each, for every agent`s page; the Plan tab`s goal folds by its head', async ($, on) => {
  await opened($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // the Orchestrator's page: its task (your prompts) and its checklist, the plan's steps
    await press(ui, 'dash:agent:main')
    expect(await heads(ui)).toEqual([
      ['fold:page:task', '▾ Task'],
      ['fold:page:checklist', '▾ Checklist'],
    ])
    expect(await ui.find({ key: 'check:0' })).toBeDefined()
    await press(ui, 'fold:page:checklist')
    expect((await ui.find({ key: 'fold:page:checklist' }))?.props.label).toBe('▸ Checklist')
    const list = (await ui.find({ key: 'page:checklist' }))?.text ?? ''
    expect(list).toContain('Fix it and run the tests')
    expect(list).toContain('1/3')
    expect(await ui.find({ key: 'check:0' })).toBeUndefined()

    // fixer's page: its task folded to its scope and first line; the fold holds for every page
    await press(ui, 'page:back')
    await press(ui, 'dash:agent:agent-fixer')
    expect((await ui.find({ key: 'page:task' }))?.text).toContain('Fix the login bug in src/auth.ts and run the tests')
    await press(ui, 'fold:page:task')
    expect((await ui.find({ key: 'fold:page:task' }))?.props.label).toBe('▸ Task')
    expect(await ui.find({ type: 'Text', text: /^Fix the login bug · Fix the login bug in src\/auth\.ts and run the tests$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Fix the login bug in src\/auth\.ts and run the tests$/ })).toBeUndefined()
    await press(ui, 'page:back')
    await press(ui, 'dash:agent:main')
    expect((await ui.find({ key: 'fold:page:task' }))?.props.label).toBe('▸ Task')
    expect((await ui.find({ key: 'fold:page:checklist' }))?.props.label).toBe('▸ Checklist')
    await press(ui, 'fold:page:task')
    await press(ui, 'fold:page:checklist')
    expect(await ui.find({ key: 'check:0' })).toBeDefined()
    await press(ui, 'page:back')

    // the Plan tab's goal: its head and headline folded, the progress and the steps still there
    await press(ui, 'tab:plan')
    expect((await ui.find({ key: 'fold:plan:goal' }))?.props.label).toBe('▾ GOAL')
    expect((await ui.find({ key: 'plan:goal' }))?.text).toContain('Keep the old tokens working while the new ones roll out.')
    await press(ui, 'fold:plan:goal')
    const goal = (await ui.find({ key: 'plan:goal' }))?.text ?? ''
    expect(goal).toContain('▸ GOAL')
    expect(goal).toContain('· Fix the login bug')
    expect(goal).not.toContain('Keep the old tokens')
    expect(await ui.find({ key: 'plan:progress' })).toBeDefined()
    expect(await ui.find({ key: 'plan:steps' })).toBeDefined()
    // the Dashboard's goal is a section of its own: still open
    await press(ui, 'tab:dashboard')
    expect(await ui.find({ key: 'dash:goal' })).toBeDefined()
    await press(ui, 'tab:plan')
    await press(ui, 'fold:plan:goal')
    expect((await ui.find({ key: 'plan:goal' }))?.text).toContain('Keep the old tokens working while the new ones roll out.')
    await press(ui, 'tab:dashboard')
    await ui.unmount()
  }
})
