/**
 * The native dashboard (`/deck`): the Dashboard drawn from the web deck's
 * own state (`webStateOf`), what needs you answered through the resolver the
 * page's `answer` command takes, the sample (`/deck demo`), the tab row, the
 * Org tab's chart Client, and an agent's page with Back to the tab it was
 * opened from; at the pane's 68 and 84 cells and below them.
 *
 * tests/world.ts answers `ui.invalidate` itself, so a mounted pane is drawn
 * again by `redraw`, after a press that changed what it shows.
 */
import type { JsonValue, On, RenderElement } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import { chartAgentsOf } from '../hooks/ui/dash/dashModel'
import { orgTab } from '../hooks/ui/dash/org'
import { MAX_ROWS, orgSizeOf } from '../hooks/ui/dash/orgLayout'
import { P, TONE } from '../hooks/ui/dash/palette'
import type { DashActions, Kit } from '../hooks/ui/types'
import * as W from '../hooks/web'
import type { DeckData, DeckSnapshot } from '../types'
import { deck, lastState, newWorld, NOW, work, world, type World } from './world'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane<S extends Surface>(surface: S, bodyColumns = 96) {
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

type Element = { type?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

/** The element keyed `key` in a drawn tree, as drawn (its `hover` beside its props), depth first. */
function keyed(tree: unknown, key: string): Element | undefined {
  if (!tree || typeof tree !== 'object') return undefined
  const node = tree as Element
  if (node.props?.key === key) return node
  for (const child of node.children ?? []) {
    const found = keyed(child, key)
    if (found) return found
  }
  return undefined
}

/** A press, then the drawing as the pane draws it next. */
async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

const QUESTION = {
  question: 'Which library should we use for dates?',
  header: 'Library',
  multiSelect: false,
  options: [
    { label: 'date-fns', description: 'Small and modular' },
    { label: 'Luxon', description: 'Time zones built in' },
  ],
}
const CHECKS = {
  question: 'Which checks should run?',
  header: 'Checks',
  multiSelect: true,
  options: [
    { label: 'Lint', description: 'eslint' },
    { label: 'Types', description: 'tsc' },
    { label: 'Tests', description: 'node --test' },
  ],
}
const PATCH = ['@@ -1,3 +1,3 @@', ' const a = 1', '-const b = 2', '+const b = 3', ' export { a, b }'].join('\n')

function todo(content: string, status: 'completed' | 'in_progress' | 'pending', activeForm = content) {
  return { content, status, activeForm }
}

/**
 * A session under way: you asked to fix a login bug; the Orchestrator keeps
 * a three-step todo list and asks you which library to use; fixer (on step
 * two) edited src/auth.ts, runs the tests and waits on your OK for them;
 * helper, which fixer started, has finished.
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
    tokensIn: 40_000,
    tokensOut: 8_000,
  })
  data.agents.push(fixer)
  data.agents.push(M.newAgent('agent-helper', 'agent', 'helper', NOW - 300_000, { type: 'Explore', parentId: fixer.id, status: 'completed', endedAt: NOW - 200_000, description: 'Find the auth module', answer: 'It is src/auth.ts' }))
  M.beginTool(data, fixer, M.activityOf('t1', 'Bash', { command: 'npm test', description: 'Run the unit tests' }, '/repo', NOW - 20_000))
  M.addEdit(data, fixer, { id: 'e1', agent: fixer.id, tool: 'Edit', path: 'src/auth.ts', abs: '/repo/src/auth.ts', at: NOW - 60_000, added: 1, removed: 1, patch: PATCH, isNew: false })
  M.notePending(data, { id: 'toolu_q', agentId: M.MAIN, kind: 'question', tool: 'AskUserQuestion', at: NOW - 5_000, questions: [QUESTION] })
  M.notePending(data, M.permissionOf({ id: 'toolu_p', tool: 'Bash', input: { command: 'npm test', description: 'Run the unit tests' }, agentId: 'agent-fixer', at: NOW - 4_000 }, '/repo'))
  return data
}

function snapshot(data: DeckData, view: Partial<DeckSnapshot['view']> = {}): DeckSnapshot {
  return { v: M.SNAPSHOT_VERSION, data: M.copyOf(data), view: { ...M.defaultView(), ...view } }
}

/** The instance a test draws a piece of the dashboard into by itself (`probe`). */
const PROBE = 'dash-probe'

/** Draws `draw`'s tree as the deck's pane would, under the PROBE instance, with the surface's own elements. */
function probe(on: On, draw: (kit: Kit) => RenderElement): void {
  on('ui.render', { component: 'Pane', requestId: PROBE }, ($, e) => {
    const ui = $.ui.resolve(e)
    return draw({
      surface: e.surface,
      Box: ui.Box,
      Text: ui.Text,
      Button: ui.Button,
      Code: ui.Code,
      Markdown: ui.Markdown,
      columns: Math.max(24, e.props.bodyColumns - 1),
      ...('Input' in ui ? { Input: ui.Input } : {}),
      ...('Svg' in ui && e.surface !== 'terminal' ? { Svg: ui.Svg } : {}),
    })
  })
}

/** Actions that do nothing, for a piece drawn by itself. */
function inert(): DashActions {
  return new Proxy({}, { get: () => () => undefined }) as DashActions
}

/** The engine for these tests: tests/world.ts, plus the Client's posts and faults, which nothing beneath the deck answers there. */
function engine(on: On, w: World, restored?: DeckSnapshot) {
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  world(on, w, restored)
}

/** The session above, restored as a reload finds it, and the pane opened with /deck. */
async function opened($: Engine, on: On, w: World = newWorld()) {
  const clock = mock.clock(on, { now: NOW })
  engine(on, w, snapshot(sessionData()))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await clock.advance(1000)
  return clock
}

test('/deck opens the Dashboard, drawn from the web deck`s own state: what needs you, the goal and its step, a card an agent, the four figures, the activity', async ($, on) => {
  await opened($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'tab:dashboard' }))?.props).toMatchObject({ label: 'Dashboard', dimColor: false, hotkey: '1' })

    // what needs you: the question (restored by a reload, so its options read-only) and the permission
    const asked = await ui.find({ key: 'needs:toolu_q' })
    expect(asked?.text).toContain('Orchestrator asks you')
    expect(asked?.text).toContain('Which library should we use for dates?')
    expect(asked?.text).toContain('Time zones built in')
    expect(asked?.text).toContain('Answer it in Claude Code.')
    expect(await ui.find({ key: 'answer:toolu_q:0:0' })).toBeUndefined()
    expect(await ui.find({ key: 'other:toolu_q:0' })).toBeUndefined()
    const permit = await ui.find({ key: 'needs:toolu_p' })
    expect(permit?.text).toContain('fixer needs your OK to run npm test')
    expect(permit?.text).toContain('Run the unit tests')
    expect(permit?.text).toContain('Allow or deny it in Claude Code.')
    expect((await ui.find({ key: 'needs:open:toolu_p' }))?.props).toMatchObject({ label: 'Open', plain: true })

    // the goal: its headline, its words after it, the step in hand, the plan's bar (an image where Svg draws, cells on the terminal)
    const goal = await ui.find({ key: 'dash:goal' })
    expect((await ui.find({ type: 'Text', text: 'Fix the login bug' }))?.props).toMatchObject({ bold: true, color: P.text })
    expect(goal?.text).toContain('Keep the old tokens working while the new ones roll out.')
    expect(goal?.text).toContain('Step 2 of 3 · Fix it and run the tests')
    const bar = (await ui.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Plan:'))
    if (surface === 'desktop') expect(bar?.props.alt).toBe('Plan: 1 of 3 steps done')
    else expect(bar).toBeUndefined()

    // the agents: a card each, its edge and hover in its status's hue, its name a plain Button, its pill, its line, its foot
    expect((await ui.findAll({ type: 'Box' })).map(box => box.key).filter(key => key?.startsWith('card:'))).toEqual(['card:main', 'card:agent-fixer', 'card:agent-helper'])
    const fixer = await ui.find({ key: 'card:agent-fixer' })
    expect(fixer?.props).toMatchObject({ borderStyle: 'round', borderColor: TONE.waiting.edge })
    const drawn = await ui.drawn()
    expect(keyed(drawn, 'card:agent-fixer')?.hover).toEqual({ borderColor: TONE.waiting.hot })
    expect((await ui.find({ key: 'card:agent-helper' }))?.props.borderColor).toBe(P.border)
    expect(keyed(drawn, 'card:agent-helper')?.hover).toEqual({ borderColor: TONE.done.hot })
    expect((await ui.find({ key: 'dash:agent:agent-fixer' }))?.props).toMatchObject({ label: 'fixer', plain: true })
    expect(fixer?.text).toContain(' waiting ')
    expect(fixer?.text).toContain('Needs your OK to run npm test')
    expect(fixer?.text).toContain('haiku-4.5 · 48k · waiting · 6m')
    const pills = await ui.findAll({ type: 'Text', text: /^ waiting $/ })
    expect(pills.length).toBe(2)
    expect(pills.map(one => [one.props.color, one.props.backgroundColor])).toEqual([
      [TONE.waiting.pillFg, TONE.waiting.pillBg],
      [TONE.waiting.pillFg, TONE.waiting.pillBg],
    ])
    expect((await ui.find({ key: 'card:agent-helper' }))?.text).toContain('finished 3m ago')

    // the four figures
    const kpis = await Promise.all(['running', 'plan', 'spend', 'waiting'].map(key => ui.find({ key: `kpi:${key}` })))
    expect(kpis[0]?.text).toContain('Agents running')
    expect(kpis[1]?.text).toContain('1/3')
    expect(kpis[1]?.text).toContain('Now: Fix it and run the tests')
    expect(kpis[2]?.text).toContain('$1.25')
    expect(kpis[3]?.text).toContain('Waiting on you')
    expect(kpis[3]?.text).toContain('Orchestrator asks: Which library should we use for dates?')

    // the activity: fixer's call, worded as the page words it (a shell call's target is what it says it does)
    const call = (await ui.findAll({ type: 'Button' })).find(button => button.key?.startsWith('dash:act:') && button.text.includes('fixer'))
    expect(call?.text).toBe('fixer ran Run the unit tests')

    // avatars: the gradient faces as images where Svg draws, a dot of their colour on the terminal
    const faces = (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).endsWith('avatar'))
    if (surface === 'desktop') {
      expect(faces.map(face => face.props.alt)).toContain("fixer's avatar")
      expect(String(faces[0]?.props.source)).toContain('linearGradient')
    } else {
      expect(faces).toEqual([])
    }
    await ui.unmount()
  }
})

/** The talk between the Orchestrator and you about questions, as [from, to, kind, text], from the web deck's state. */
function asked(w: World): [string, string, string, string][] {
  return lastState(w)
    .messages.filter(one => one.kind === 'question' || one.kind === 'choice')
    .map(one => [one.from, one.to, one.kind, one.text])
}

test('a press on an option answers the question through the resolver the page`s answer command takes: the call returns it, the dialog beneath is let go, Talk says so', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  engine(on, w)
  await work($)
  const call = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'toolu_q1', questions: [QUESTION] } as never)
  await clock.settle()
  await $.command.run(deck(''))
  const ui = await $.ui.mount(pane('desktop'))

  // one question, one answer: an option a Button (its description dim under it) that answers at the press, Other, no Submit
  const luxon = await ui.find({ key: 'answer:toolu_q1:0:1' })
  expect(luxon?.text).toBe('Luxon')
  expect(luxon?.props.variant).toBe('secondary')
  expect((await ui.find({ type: 'Text', text: 'Time zones built in' }))?.props.color).toBe(P.muted)
  expect((await ui.find({ key: 'other:toolu_q1:0' }))?.props).toMatchObject({ label: 'Other…', submitLabel: 'answer' })
  expect(await ui.find({ key: 'answer:toolu_q1' })).toBeUndefined()
  expect((await ui.find({ key: 'needs:toolu_q1' }))?.text).toContain('Or answer it in Claude Code.')

  await ui.press({ key: 'answer:toolu_q1:0:1' })
  expect(await call).toMatchObject({ result: { questions: [QUESTION], answers: { [QUESTION.question]: 'Luxon' } } })
  expect(w.held[0]?.isAborted).toBe(true)
  expect(w.toasts).toContain('Answered: Claude carries on')
  await clock.advance(400)
  expect(asked(w)).toEqual([
    ['main', 'you', 'question', QUESTION.question],
    ['you', 'main', 'choice', 'You answered: Luxon'],
  ])
  await ui.redraw()
  expect(await ui.find({ key: 'needs:toolu_q1' })).toBeUndefined()
  await ui.unmount()
})

test('several questions are a form: a multi-select`s options toggle, Other keeps words of your own, Submit sends them all once every question has an answer', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  engine(on, w)
  await work($)
  const call = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'toolu_q2', questions: [QUESTION, CHECKS] } as never)
  await clock.settle()
  await $.command.run(deck(''))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'needs:toolu_q2' }))?.text).toContain('Orchestrator asks 2 questions')
    expect((await ui.find({ key: 'answer:toolu_q2' }))?.props).toMatchObject({ label: 'Submit answers', variant: 'primary' })
    expect((await ui.find({ key: 'answer:toolu_q2:1:0' }))?.text).toBe('☐ Lint')
    await ui.unmount()
  }

  const ui = await $.ui.mount(pane('desktop'))
  await press(ui, 'answer:toolu_q2:1:0')
  await press(ui, 'answer:toolu_q2:1:2')
  await press(ui, 'answer:toolu_q2:1:1')
  await press(ui, 'answer:toolu_q2:1:1')
  expect((await ui.find({ key: 'answer:toolu_q2:1:0' }))?.text).toBe('☑ Lint')
  expect((await ui.find({ key: 'answer:toolu_q2:1:1' }))?.text).toBe('☐ Types')
  // too soon: the first question has no answer yet, and Submit says so
  await press(ui, 'answer:toolu_q2')
  expect(w.held[0]?.isAborted).toBe(false)
  expect((await ui.find({ key: 'needs:toolu_q2' }))?.text).toContain('Pick an answer for Library first.')
  // a pick, then words of your own in its place, kept until Submit
  await press(ui, 'answer:toolu_q2:0:0')
  expect((await ui.find({ key: 'answer:toolu_q2:0:0' }))?.text).toBe('● date-fns')
  await ui.input({ key: 'other:toolu_q2:0', text: '  Temporal, once it ships  ' })
  await ui.redraw()
  expect((await ui.find({ key: 'answer:toolu_q2:0:0' }))?.text).toBe('○ date-fns')
  expect((await ui.find({ key: 'other:toolu_q2:0' }))?.props.value).toBe('Temporal, once it ships')
  await ui.press({ key: 'answer:toolu_q2' })
  expect(await call).toMatchObject({ result: { answers: { [QUESTION.question]: 'Temporal, once it ships', [CHECKS.question]: 'Lint, Tests' } } })
  await clock.advance(400)
  expect(asked(w)[1]).toEqual(['you', 'main', 'choice', 'You answered: Library: Temporal, once it ships · Checks: Lint, Tests'])
  await ui.unmount()
})

/** When the sample below was written: a month before the tests' now. */
const SAMPLE_NOW = NOW - 30 * 86_400_000

/**
 * A sample in web/fixtures/state.json's own shape (`webStateOf` wrote it a
 * month ago): six agents (one done, one failed, one nested), a question the
 * deck may answer and a permission prompt.
 */
function sampleText(): string {
  const at = (minutes: number) => SAMPLE_NOW - minutes * 60_000
  const data = M.emptyData(at(40))
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  main.model = 'claude-opus-5-5'
  M.noteGoal(data, 'goal', { text: 'Add per-user rate limiting to the public API', origin: 'composer', at: at(36) })
  const add = (id: string, name: string, extra: Partial<DeckData['agents'][number]> = {}) => {
    const one = M.newAgent(id, 'agent', name, at(30), { type: 'general-purpose', parentId: M.MAIN, status: 'running', description: name, ...extra })
    data.agents.push(one)
    return one
  }
  add('s-explore', 'Explore routes', { type: 'Explore', status: 'completed', endedAt: at(31), answer: 'Found 14 public routes' })
  const limiter = add('s-limiter', 'Limiter', { prompt: 'Write the sliding-window limiter' })
  add('s-redis', 'Redis store', { parentId: 's-limiter' })
  add('s-tests', 'Tests')
  add('s-docs', 'Docs', { status: 'failed', endedAt: at(6), answer: 'CHANGELOG.md has no Unreleased section' })
  M.beginTool(data, limiter, M.activityOf('s1', 'Edit', { file_path: '/acme/src/rateLimit.ts' }, '/acme', at(1)))
  M.notePending(data, { id: 'toolu_sq', agentId: M.MAIN, kind: 'question', tool: 'AskUserQuestion', at: at(0.5), questions: [QUESTION] })
  M.notePending(data, M.permissionOf({ id: 'toolu_sp', tool: 'Bash', input: { command: 'npm test -- rateLimit' }, agentId: 's-tests', at: at(2) }, '/acme'))
  const usage = { startedAt: at(40), costUsd: 6.42, contextPercent: 38, limits: [] }
  return JSON.stringify(W.webStateOf(data, M.defaultView(), emptyGit(), usage, SAMPLE_NOW, 'sample', '/acme', new Set(['toolu_sq'])))
}

test('/deck demo draws the sample: Sample data and Back to this chat in its header, every part of the Dashboard, its times moved to now; nothing of this session in it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  const reads: string[] = []
  on('fs.read', ($, e) => {
    reads.push(e.path)
    return /state\.json$/.test(e.path) ? { value: sampleText() } : { deny: 'no such file' }
  })
  engine(on, w)
  // this session is under way (scout runs): the sample shows none of it
  await work($)
  expect((await $.command.run(deck('demo'))).text).toBeUndefined()
  expect(reads[0]).toMatch(/web[\\/]fixtures[\\/]state\.json$/)
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'demo:back' }))?.props).toMatchObject({ label: 'Back to this chat', variant: 'primary' })
    expect((await ui.find({ type: 'Text', text: ' Sample data ' }))?.props).toMatchObject({ bold: true, color: P.waitText })
    expect((await ui.find({ key: 'tab:dashboard' }))?.props.dimColor).toBe(false)
    const cards = (await ui.findAll({ type: 'Box' })).map(box => box.key).filter(key => key?.startsWith('card:'))
    expect(cards).toEqual(['card:main', 'card:s-docs', 'card:s-explore', 'card:s-limiter', 'card:s-redis', 'card:s-tests'])
    expect((await ui.find({ key: 'answer:toolu_sq:0:0' }))?.text).toBe('date-fns')
    expect((await ui.find({ key: 'needs:toolu_sp' }))?.text).toContain('Tests needs your OK to run npm test -- rateLimit')
    // its times as of now: the goal set 36 minutes before the sample was written reads 36m
    expect((await ui.find({ key: 'dash:goal' }))?.text).toContain('36m')
    expect((await ui.find({ key: 'card:s-docs' }))?.text).toContain('failed 6m ago')
    for (const key of ['kpi:running', 'kpi:plan', 'kpi:spend', 'kpi:waiting']) expect(await ui.find({ key })).toBeDefined()
    expect((await ui.find({ key: 'kpi:spend' }))?.text).toContain('$6.42')
    expect((await ui.findAll({ type: 'Button' })).some(button => button.key?.startsWith('dash:act:'))).toBe(true)
    // nothing of this session: not its agent, not its web deck
    expect(await ui.find({ key: 'card:agent-x1' })).toBeUndefined()
    expect(await ui.find({ key: 'dash:web' })).toBeUndefined()
    await ui.unmount()
  }
})

test('in the sample an answer stays in the sample, Talk sends nothing, and the tabs of this session are not shown; Back to this chat, or /deck, returns to it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  on('fs.read', ($, e) => (/state\.json$/.test(e.path) ? { value: sampleText() } : { deny: 'no such file' }))
  engine(on, w)
  await work($)
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  const ui = await $.ui.mount(pane('desktop'))

  // an answer: the sample's question goes, its Orchestrator carries on; no call of this session's is answered
  await press(ui, 'answer:toolu_sq:0:1')
  expect(w.toasts).toContain('Sample data: you answered Luxon. Nothing was sent to Claude.')
  expect(await ui.find({ key: 'needs:toolu_sq' })).toBeUndefined()
  expect((await ui.find({ key: 'card:main' }))?.text).toContain('Carrying on with your answer')
  expect(w.held).toEqual([])
  await clock.advance(400)
  expect(asked(w)).toEqual([])

  // Talk on a sample agent's page sends nothing anywhere
  await press(ui, 'dash:agent:s-limiter')
  await press(ui, 'detail:chat')
  await ui.input({ key: 'chat:s-limiter', text: 'hello' })
  expect(w.toasts).toContain('Sample data: nothing is sent. Back to this chat to talk to your agents.')
  expect(w.sent).toEqual([])
  expect(w.submitted.filter(one => one.text === 'hello')).toEqual([])
  await press(ui, 'detail:edits')

  // Changes, Stats and Classic are this session's: the sample says so
  for (const tab of ['changes', 'stats', 'agents']) {
    await press(ui, `tab:${tab}`)
    expect(await ui.find({ type: 'Text', text: /^The sample covers the Dashboard, Org and the agent pages\./ })).toBeDefined()
  }

  // Back to this chat: this session's Dashboard, its scout among the cards
  await press(ui, 'demo:back')
  expect(await ui.find({ key: 'demo:back' })).toBeUndefined()
  expect((await ui.find({ key: 'tab:agents' }))?.props.dimColor).toBe(false)
  await press(ui, 'tab:dashboard')
  expect(await ui.find({ key: 'card:agent-x1' })).toBeDefined()

  // and /deck alone leaves it too
  await $.command.run(deck('demo'))
  await ui.redraw()
  expect(await ui.find({ key: 'demo:back' })).toBeDefined()
  await $.command.run(deck(''))
  await ui.redraw()
  expect(await ui.find({ key: 'demo:back' })).toBeUndefined()
  expect(await ui.find({ key: 'card:agent-x1' })).toBeDefined()
  await ui.unmount()
})

test('a sample that cannot be read says so where the Dashboard would be, and /deck demo answers why', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('fs.read', () => ({ deny: 'no such file' }))
  engine(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const said = await $.command.run(deck('demo'))
  expect(said.text).toBe('The sample could not be read: web/fixtures/state.json is missing, or not a deck state.')
  await clock.advance(1000)
  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ type: 'Text', text: said.text ?? '' })).toBeDefined()
  expect(await ui.find({ key: 'demo:back' })).toBeDefined()
  await ui.unmount()
})

test('the tab row switches tabs: Org draws the chart Client sized to the chart, Changes, Stats and Classic stay as they were; a tab pressed on an agent page leaves it', async ($, on) => {
  await opened($, on)
  const state = W.webStateOf(sessionData(), M.defaultView(), emptyGit(), null, NOW, 's', '/repo')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:org')
    expect((await ui.find({ key: 'tab:org' }))?.props).toMatchObject({ label: 'Org', dimColor: false, hotkey: '2' })
    const client = await ui.find({ type: 'Client' })
    const agents = chartAgentsOf(state)
    expect(client?.key).toBe('org')
    expect(client?.props).toMatchObject({ module: 'hooks/ui/dash/org.client.tsx', width: '100%', height: Math.min(MAX_ROWS, orgSizeOf(agents, 95).rows) })
    const props = client?.props.props as { agents: { id: string; parent: string | null; tokens: string }[]; selected: string | null }
    expect(props.agents.map(one => [one.id, one.parent])).toEqual([
      ['main', null],
      ['agent-fixer', 'main'],
      ['agent-helper', 'agent-fixer'],
    ])
    expect(props.agents.map(one => one.tokens)).toEqual(['', '48k', ''])
    // the chart marks the agent whose page was opened last: none on the first surface, fixer (opened below) on the next
    expect(props.selected).toBe(surface === 'terminal' ? null : 'agent-fixer')

    await press(ui, 'tab:changes')
    expect((await ui.find({ key: 'tab:changes' }))?.props).toMatchObject({ dimColor: false, hotkey: '3' })
    await press(ui, 'tab:stats')
    expect((await ui.find({ key: 'tab:stats' }))?.props).toMatchObject({ dimColor: false, hotkey: '4' })
    await press(ui, 'tab:agents')
    expect((await ui.find({ key: 'web:open' }))?.props.label).toBe('Open dashboard')
    // an agent page over the Dashboard; a tab pressed there opens that tab
    await press(ui, 'tab:dashboard')
    await press(ui, 'dash:agent:agent-fixer')
    expect(await ui.find({ key: 'page:back' })).toBeDefined()
    await press(ui, 'tab:stats')
    expect(await ui.find({ key: 'page:back' })).toBeUndefined()
    await press(ui, 'tab:dashboard')
    await ui.unmount()
  }
})

test('where no Client draws (VS Code), and where the chart`s Client failed, the Org tab lists the agents as a tree', async ($, on) => {
  // a surface whose Client failed (its ui.fault): the same tree, saying why
  const state = W.webStateOf(sessionData(), M.defaultView(), emptyGit(), null, NOW, 's', '/repo')
  probe(on, kit => orgTab(kit, state, inert(), { state, isDemo: false, demoNote: '', paneData: sessionData(), isOrgDown: true, selected: 'agent-fixer' }))
  await opened($, on)
  const vscode = await $.ui.mount(pane('vscode'))
  await press(vscode, 'tab:org')
  expect(await vscode.find({ type: 'Client' })).toBeUndefined()
  expect((await vscode.findAll({ type: 'Button' })).map(button => button.key).filter(key => key?.startsWith('org:agent:'))).toEqual(['org:agent:main', 'org:agent:agent-fixer', 'org:agent:agent-helper'])
  await press(vscode, 'org:agent:agent-helper')
  expect((await vscode.find({ key: 'page:back' }))?.props.label).toBe('← Org')
  await press(vscode, 'page:back')
  await vscode.unmount()

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ type: 'Client' }))?.key).toBe('org')
    await ui.unmount()
  }

  const down = await $.ui.mount({ ...pane('desktop'), requestId: PROBE })
  expect(await down.find({ type: 'Client' })).toBeUndefined()
  expect(await down.find({ type: 'Text', text: /^The chart could not draw here, so the agents are listed instead\./ })).toBeDefined()
  expect((await down.find({ key: 'org:agent:agent-fixer' }))?.props.variant).toBe('primary')
  expect((await down.find({ key: 'org:agent:main' }))?.props.plain).toBe(true)
  await down.unmount()
})

test('an agent`s page: its header, who it reports to, its Now line, task and checklist, then the detail`s own Diffs, Talk and Tool calls; Back returns to the tab it was opened from', async ($, on) => {
  await opened($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'dash:agent:agent-fixer')
    expect((await ui.find({ key: 'page:back' }))?.props).toMatchObject({ label: '← Dashboard', plain: true, hotkey: 'b' })
    const head = await ui.find({ key: 'page:head' })
    expect(head?.text).toContain('fixer')
    expect(head?.text).toContain('general-purpose · reports to')
    expect(head?.text).toContain(' waiting ')
    expect(head?.text).toContain('started 6m ago · 1 tool call')
    expect((await ui.find({ key: 'page:boss:main' }))?.props).toMatchObject({ label: 'Orchestrator', plain: true })
    expect((await ui.find({ key: 'page:now' }))?.props).toMatchObject({ borderStyle: 'quote', borderColor: TONE.waiting.hue })
    expect((await ui.find({ key: 'page:now' }))?.text).toContain('Needs your OK to run npm test')
    expect((await ui.find({ key: 'page:task' }))?.text).toContain('Fix the login bug in src/auth.ts and run the tests')
    // what it waits on you for, here too; no Open on its own page
    expect(await ui.find({ key: 'needs:toolu_p' })).toBeDefined()
    expect(await ui.find({ key: 'needs:open:toolu_p' })).toBeUndefined()
    expect(await ui.find({ key: 'needs:toolu_q' })).toBeUndefined()
    // the detail's panes: Diffs first, its exact patch; Tool calls
    expect((await ui.find({ key: 'detail:edits' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ type: 'Code' }))?.text).toContain('+const b = 3')
    await press(ui, 'detail:activity')
    expect(await ui.find({ type: 'Text', text: 'Bash' })).toBeDefined()
    await press(ui, 'detail:edits')

    // who it reports to: a press opens the Orchestrator's page, its checklist the plan's steps
    await press(ui, 'page:boss:main')
    expect((await ui.find({ key: 'page:head' }))?.text).toContain('main loop · reports to')
    const steps = await ui.find({ key: 'page:checklist' })
    expect(steps?.text).toContain('1/3')
    expect(steps?.text).toContain('Fix it and run the tests')
    expect(await ui.find({ key: 'needs:toolu_q' })).toBeDefined()
    await press(ui, 'page:back')
    expect(await ui.find({ key: 'page:back' })).toBeUndefined()
    expect((await ui.find({ key: 'tab:dashboard' }))?.props.dimColor).toBe(false)

    // from an activity row
    const row = (await ui.findAll({ type: 'Button' })).find(button => button.key?.startsWith('dash:act:'))
    await press(ui, row?.key ?? '')
    expect((await ui.find({ key: 'page:head' }))?.text).toContain('fixer')
    await press(ui, 'page:back')
    await ui.unmount()
  }
})

test('a card the org chart posts opens that agent`s page, Back returning to Org; a post of anything else, or of an agent the pane does not hold, is let go', async ($, on) => {
  await opened($, on)
  const ui = await $.ui.mount(pane('desktop'))
  await press(ui, 'tab:org')
  const junks: JsonValue[] = ['open', { type: 'open' }, { type: 'open', id: 'nobody' }, { type: 'open', id: 'you' }, { type: 'pan', id: 'agent-helper' }]
  for (const junk of junks) {
    await ui.post(junk, { in: 'org' })
    await ui.redraw()
    expect(await ui.find({ key: 'page:back' })).toBeUndefined()
  }
  await ui.post({ type: 'open', id: 'agent-helper' }, { in: 'org' })
  await ui.redraw()
  expect((await ui.find({ key: 'page:back' }))?.props.label).toBe('← Org')
  expect((await ui.find({ key: 'page:head' }))?.text).toContain('helper')
  expect((await ui.find({ key: 'page:boss:agent-fixer' }))?.props.label).toBe('fixer')
  await press(ui, 'page:back')
  expect((await ui.find({ key: 'tab:org' }))?.props.dimColor).toBe(false)
  expect(((await ui.find({ type: 'Client' }))?.props.props as { selected: string | null }).selected).toBe('agent-helper')
  await ui.unmount()
})

test('the layout keeps to the pane: two agent cards and four figures a row from 60 cells (the pane`s 68 to 84), one card and two figures below', async ($, on) => {
  await opened($, on)
  for (const [body, card, kpi] of [
    [68, 33, 16],
    [84, 41, 20],
    [56, 55, 27],
  ] as const) {
    const ui = await $.ui.mount(pane('desktop', body))
    const boxes = await ui.findAll({ type: 'Box' })
    expect(boxes.filter(box => box.key?.startsWith('card:')).map(box => box.props.width)).toEqual([card, card, card])
    expect(boxes.filter(box => box.key?.startsWith('kpi:')).map(box => box.props.width)).toEqual([kpi, kpi, kpi, kpi])
    // a card's name leaves room for its pill: cut, never wrapped
    const name = await ui.find({ key: 'dash:agent:agent-fixer' })
    expect(Array.from(String(name?.props.label)).length <= card - 4 - 9 - 5).toBe(true)
    await ui.unmount()
  }
})
