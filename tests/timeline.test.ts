/**
 * Org's Timeline: what the model keeps of each loop beyond its own fields
 * (hooks/lane.ts: its calls past the newest 14, the runs it ended before it
 * ran again, the Orchestrator's turns, its waits on you), the view model
 * built from it (hooks/timeline.ts, timeline.json), and the pane's two
 * drawings of it (hooks/ui/v2/timeline.tsx): the desktop's one image under
 * the pane's bounds, the terminal's text lanes fitted to its columns. Every
 * span, tick and mark is a time Claude Code reported; what the deck does not
 * know is not drawn.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import * as T from '../hooks/timeline'
import { MOST_LANES, axisLineOf, laneCellsOf, timelineSvgOf, timelineSummaryOf } from '../hooks/ui/v2/timeline'
import * as W from '../hooks/web'
import type { DeckAgent, DeckData } from '../types'
import { IDS, SAMPLE_NOW, ago, v2Session } from './v2session'
import { deck, newWorld, work, world, type World } from './world'

const NOW = 1_700_000_100_000
const MIN = 60_000

/** An agent spawned under the Orchestrator at `at`. */
function spawned(data: DeckData, id: string, name: string, at: number, extra: { isTeammate?: boolean } = {}): DeckAgent {
  return M.noteSpawn(data, { toolUseId: `toolu_${id}`, agentId: id, parentId: M.MAIN, name, description: name, prompt: `Do ${name}`, type: 'general-purpose', isTeammate: extra.isTeammate === true, at }).agent
}

/** A call made and ended in `agent`'s loop. */
function call(data: DeckData, agent: DeckAgent, id: string, at: number, ms: number, ok = true, tool = 'Read') {
  M.beginTool(data, agent, M.activityOf(id, tool, { file_path: `/repo/${id}.ts` }, '/repo', at))
  M.endTool(agent, id, ok, at + ms)
}

/** The v2 state and its timeline, `data` at `now`. */
function built(data: DeckData, now: number): { state: W.WebStateV2; timeline: T.V2Timeline } {
  const state = W.deckStateOf(data, emptyGit(), null, now, 's1', '/repo')
  return { state, timeline: T.timelineOf(data, state) }
}

const laneOf = (timeline: T.V2Timeline, id: string) => timeline.lanes.find(lane => lane.id === id)!
const spansOf = (timeline: T.V2Timeline, lane: T.V2Lane) => lane.spans.map(span => [span.kind, timeline.startedAt + span.from, span.to === null ? null : timeline.startedAt + span.to])

// ---------------------------------------------------------------------------
// What the model keeps (hooks/lane.ts).

test('each call is a tick: its start, length and outcome kept past the newest 14 the model keeps whole, the newest 400 of them', () => {
  const data = M.emptyData(NOW)
  const one = spawned(data, 'agent-a1', 'reader', NOW)
  for (let i = 0; i < 20; i++) call(data, one, `toolu_r${i}`, NOW + i * 1000, 300, i !== 7)
  expect(one.recent).toHaveLength(14)
  expect(one.lane?.calls).toHaveLength(20)
  expect(one.lane?.calls[0]).toEqual([0, 300, 0, 1])
  expect(one.lane?.calls[7]).toEqual([7000, 300, 0, 0])
  expect(one.lane?.tools).toEqual(['Read'])
  // a call still running has no length yet, nor an outcome
  M.beginTool(data, one, M.activityOf('toolu_live', 'Bash', { command: 'npm test' }, '/repo', NOW + 30_000))
  expect(one.lane?.calls.at(-1)).toEqual([30_000, -1, 1, -1])
  // the newest 400 kept
  for (let i = 0; i < 450; i++) call(data, one, `toolu_m${i}`, NOW + 60_000 + i * 100, 50)
  expect(one.lane?.calls).toHaveLength(400)
  expect(one.lane?.calls.at(-1)?.[0]).toBe(60_000 + 449 * 100)
})

test('a run that ended is kept when the agent runs again (a message woke it, a teammate`s next turn); waits on you last from a need raised to its end', () => {
  const data = M.emptyData(NOW)
  const helper = spawned(data, 'agent-h1', 'helper', NOW)
  call(data, helper, 'toolu_h1', NOW + MIN, 500)
  Object.assign(helper, { status: 'completed', endedAt: NOW + 2 * MIN })
  // a message wakes it three minutes later
  M.reopen(helper, NOW + 5 * MIN)
  expect(helper.lane?.runs).toEqual([[NOW, NOW + 2 * MIN]])
  expect(helper.lane?.woke).toBe(NOW + 5 * MIN)
  // a teammate goes idle, then its next call is its next run
  const mate = spawned(data, 'agent-t1', 'mate', NOW, { isTeammate: true })
  M.noteIdle(data, { id: 'agent-t1', name: 'mate' }, NOW + 3 * MIN)
  call(data, mate, 'toolu_t1', NOW + 4 * MIN, 200)
  expect(mate.lane?.runs).toEqual([[NOW, NOW + 3 * MIN]])
  // a permission prompt holds its call: the wait ends when the call does
  M.beginTool(data, helper, M.activityOf('toolu_b1', 'Bash', { command: 'npm test' }, '/repo', NOW + 6 * MIN))
  M.notePending(data, M.permissionOf({ id: 'toolu_b1', tool: 'Bash', input: { command: 'npm test' }, agentId: helper.id, at: NOW + 6 * MIN + 1000 }, '/repo'))
  expect(helper.lane?.waits).toEqual([{ kind: 'held', from: NOW + 6 * MIN + 1000, call: 'toolu_b1' }])
  M.dropPending(data, 'toolu_b1')
  M.endTool(helper, 'toolu_b1', true, NOW + 8 * MIN)
  expect(helper.lane?.waits[0]?.to).toBe(NOW + 8 * MIN)
  // Claude Code's notification about no call in particular ends when the loop moves on (its next call), as the deck's need does
  M.noteNotification(data, { type: 'idle_prompt', message: 'Claude is waiting for your input', agent: helper.id, at: NOW + 9 * MIN })
  expect(helper.lane?.waits.at(-1)).toEqual({ kind: 'note', from: NOW + 9 * MIN })
  call(data, helper, 'toolu_h2', NOW + 10 * MIN, 100)
  expect(helper.lane?.waits.at(-1)?.to).toBe(NOW + 10 * MIN)
})

test('the Orchestrator`s turns: each kept as it ends; one whose end never came ran until the deck last heard from it; its notifications end when its next turn starts', () => {
  const data = M.emptyData(NOW)
  const main = M.agentOf(data, M.MAIN)!
  M.noteMainTurn(data, 't1', NOW)
  M.endMainTurn(data, 't1', NOW + 2 * MIN)
  M.noteNotification(data, { type: 'idle_prompt', message: 'Claude is waiting for your input', at: NOW + 3 * MIN })
  M.noteMainTurn(data, 't2', NOW + 5 * MIN)
  expect(main.lane?.waits).toEqual([{ kind: 'note', from: NOW + 3 * MIN, to: NOW + 5 * MIN }])
  call(data, main, 'toolu_m1', NOW + 6 * MIN, 1000)
  // t2's end never came: t3 starts, and t2 ran to its last call
  M.noteMainTurn(data, 't3', NOW + 9 * MIN)
  expect(main.lane?.runs).toEqual([
    [NOW, NOW + 2 * MIN],
    [NOW + 5 * MIN, NOW + 6 * MIN + 1000],
  ])
  // a turn that ended out of order leaves the running one in place
  M.endMainTurn(data, 't2', NOW + 10 * MIN)
  expect(main.lane?.runs).toHaveLength(2)
})

test('a lane survives the snapshot, each part in its own shape; a twin row`s lane folds into the row its spawn binds', () => {
  const data = M.emptyData(NOW)
  const one = spawned(data, 'agent-a1', 'reader', NOW)
  call(data, one, 'toolu_r1', NOW + 1000, 300)
  const healed = M.healData(M.copyOf(data), NOW)
  expect(M.agentOf(healed, 'agent-a1')?.lane).toEqual(one.lane)
  const broken = M.copyOf(data)
  Object.assign(M.agentOf(broken, 'agent-a1')!, { lane: { t0: 'soon', tools: [], calls: [], runs: [], waits: [] } })
  expect(M.agentOf(M.healData(broken, NOW), 'agent-a1')?.lane).toBeUndefined()
  const odd = M.copyOf(data)
  M.agentOf(odd, 'agent-a1')!.lane!.calls.push([1, 2] as never, [5, 'x', 0, 1] as never)
  expect(M.agentOf(M.healData(odd, NOW), 'agent-a1')?.lane?.calls).toEqual(one.lane?.calls)
  // the agent's own calls seen before its spawn bound the Agent call's row: one lane
  const later = M.emptyData(NOW)
  M.addPlaceholder(later, { toolUseId: 'toolu_sp', parentId: M.MAIN, name: 'scout', description: 'Look', prompt: 'Look around', at: NOW })
  const twin = M.ensureAgent(later, 'agent-s1', NOW + 500)
  call(later, twin, 'toolu_s1', NOW + 600, 100, true, 'Grep')
  M.noteSpawn(later, { toolUseId: 'toolu_sp', agentId: 'agent-s1', parentId: M.MAIN, name: 'scout', description: 'Look', prompt: 'Look around', type: 'Explore', isTeammate: false, at: NOW + 700 })
  expect(M.agentOf(later, 'agent-s1')?.lane?.calls).toEqual([[0, 100, 0, 1]])
})

test('the view keeps Org`s pick: the Timeline once picked, the chart again on `chart`; anything else leaves it', () => {
  const fresh = M.defaultView2()
  expect(fresh.orgView).toBeUndefined()
  const picked = M.view2With(fresh, { orgView: 'timeline' })
  expect(picked.orgView).toBe('timeline')
  expect(M.view2With(picked, { orgView: 'gantt' }).orgView).toBe('timeline')
  expect(M.view2With(picked, { tab: 'chat' }).orgView).toBe('timeline')
  expect('orgView' in M.view2With(picked, { orgView: 'chart' })).toBe(false)
  expect(M.healView({ ...M.defaultView(), v2: picked }).v2.orgView).toBe('timeline')
})

// ---------------------------------------------------------------------------
// The view model (hooks/timeline.ts) on the sample.

test('the sample`s timeline: a lane an agent in the tree`s order, the Orchestrator first; its turns with idle between, its waits on you, each outcome, your prompts, messages between agents', () => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const timeline = T.timelineOf(session.data, state)
  expect(timeline).toMatchObject({ v: 2, now: SAMPLE_NOW, startedAt: ago(40) })
  expect(timeline.lanes.map(lane => `${lane.depth}:${lane.title}`)).toEqual(['0:Orchestrator', '1:researcher', '1:builder', '2:tester', '2:Lint the new files', '1:docs', '1:scout', '1:reviewer'])
  expect(timeline.lanes.map(lane => lane.parent)).toEqual([null, 'main', 'main', IDS.builder, IDS.builder, 'main', 'main', 'main'])
  const main = laneOf(timeline, 'main')
  expect(spansOf(timeline, main)).toEqual([
    ['work', ago(40), ago(30)],
    ['work', ago(29.5), ago(20.5)],
    ['work', ago(12), null],
    ['idle', ago(30), ago(29.5)],
    ['idle', ago(20.5), ago(12)],
    ['wait', ago(3), null],
  ])
  expect([main.start, main.end, main.outcome]).toEqual([0, null, null])
  // tester's test run held on your permission for a minute and a half; reviewer idle until builder's message woke it
  expect(spansOf(timeline, laneOf(timeline, IDS.tester)).filter(span => span[0] === 'wait')).toEqual([['wait', ago(15.9), ago(14.4)]])
  expect(spansOf(timeline, laneOf(timeline, IDS.reviewer)).filter(span => span[0] !== 'wait')).toEqual([
    ['work', ago(10), ago(9.6)],
    ['work', ago(8.9), null],
    ['idle', ago(9.6), ago(8.9)],
  ])
  // each outcome at its lane's end; those still at work (or waiting) run to now
  expect(timeline.lanes.map(lane => [lane.title, lane.outcome, lane.end === null ? null : timeline.startedAt + lane.end])).toEqual([
    ['Orchestrator', null, null],
    ['researcher', 'done', ago(31)],
    ['builder', null, null],
    ['tester', 'done', ago(12)],
    ['Lint the new files', 'failed', ago(17)],
    ['docs', 'done', ago(21)],
    ['scout', 'stopped', ago(22)],
    ['reviewer', null, null],
  ])
  // researcher's 18 calls: every start kept, the newest 14 with what they were given
  const researcher = laneOf(timeline, IDS.researcher)
  expect(researcher.ticks).toHaveLength(18)
  expect(researcher.ticks.filter(tick => tick[4] !== undefined)).toHaveLength(14)
  expect(timeline.tools[researcher.ticks[0]![2]]).toBe('Glob')
  expect(laneOf(timeline, IDS.linter).ticks).toEqual([[ago(18) - ago(40), 2100, timeline.tools.indexOf('Bash'), 0, 'npx eslint src/rateLimit.ts src/app.ts']])
  // your words to the Orchestrator; messages between two agents drawn, never one to a name no agent carries
  expect(timeline.marks.map(mark => [timeline.startedAt + mark.at, mark.text])).toEqual([
    [ago(40), 'Add per-user rate limiting to the public API. Use a sliding window, 100 requests per minute by default, configurable pe…'],
    [ago(4), 'Also exempt /health and /metrics from the limiter.'],
  ])
  expect(timeline.messages.map(one => [one.from, one.to, one.title])).toEqual([
    [IDS.builder, IDS.reviewer, 'Limiter ready for review'],
    [IDS.reviewer, IDS.builder, 'Two questions on the window'],
  ])
  expect(timeline.background).toEqual([])
  expect(timelineSummaryOf(timeline)).toBe('40m · 8 agents')
})

test('nothing the deck does not know is drawn: a wait whose end a reload lost, a gap before a resume it did not see; Clear finished leaves its agents out; background lanes only from the state`s own', () => {
  const data = M.emptyData(NOW)
  M.noteMainTurn(data, 't1', NOW)
  const one = spawned(data, 'agent-a1', 'reader', NOW)
  M.beginTool(data, one, M.activityOf('toolu_q', 'AskUserQuestion', { questions: [] }, '/repo', NOW + MIN))
  M.notePending(data, { id: 'toolu_q', agentId: one.id, kind: 'question', tool: 'AskUserQuestion', at: NOW + MIN, questions: [] })
  // still held: to now
  expect(spansOf(built(data, NOW + 5 * MIN).timeline, laneOf(built(data, NOW + 5 * MIN).timeline, one.id)).filter(span => span[0] === 'wait')).toEqual([['wait', NOW + MIN, null]])
  // a reload lost its end: no longer held, no end seen, not drawn
  M.dropStale(data, one.id, new Set())
  expect(laneOf(built(data, NOW + 5 * MIN).timeline, one.id).spans.filter(span => span.kind === 'wait')).toEqual([])
  // resumed in a build that kept no lane: its run from the wake, nothing drawn before it
  const old = M.emptyData(NOW)
  const was = spawned(old, 'agent-o1', 'old', NOW)
  Object.assign(was, { resumedAt: NOW + 4 * MIN })
  delete was.lane
  const oldLane = laneOf(built(old, NOW + 6 * MIN).timeline, was.id)
  expect(spansOf(built(old, NOW + 6 * MIN).timeline, oldLane)).toEqual([['work', NOW + 4 * MIN, null]])
  // Clear finished: the agents it hid are no lanes
  Object.assign(one, { status: 'completed', endedAt: NOW + 2 * MIN })
  const { state } = built(data, NOW + 5 * MIN)
  const cleared = W.clearedStateOf(state, { ids: [one.id], at: NOW + 3 * MIN })
  expect(T.timelineOf(data, cleared).lanes.map(lane => lane.id)).toEqual(['main'])
  // background shells: none until the state carries them, then a lane each from the times it names
  expect(T.timelineOf(data, state).background).toEqual([])
  const shells = { ...state, background: [{ id: 'b1', command: 'npm run dev', startedAt: NOW + MIN, endedAt: null }, { id: 'b2', startedAt: 'soon', command: 'x' }] } as unknown as W.WebStateV2
  expect(T.timelineOf(data, shells).background).toEqual([{ id: 'b1', title: 'npm run dev', start: MIN, end: null }])
})

test('timeline.json read back: its times moved by moving its start and now; text that is no timeline reads as none', () => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const timeline = T.timelineOf(session.data, state)
  const text = T.timelineTextOf(timeline)
  expect(text.endsWith('}\n')).toBe(true)
  const moved = T.timelineFromText(text, 3_600_000)!
  expect([moved.now, moved.startedAt]).toEqual([SAMPLE_NOW + 3_600_000, ago(40) + 3_600_000])
  expect(moved.lanes).toEqual(timeline.lanes)
  expect(T.timelineFromText('nope')).toBeNull()
  expect(T.timelineFromText('{"v":1}')).toBeNull()
  // the pane's lazy files: the live deck's built for the state it draws, the sample's as read
  expect(W.v2FilesOf(session.data).timeline(state)).toEqual(timeline)
  expect(W.v2FilesFrom({ agents: {}, patches: {}, messages: {}, timeline: moved }).timeline(state)).toBe(moved)
  expect(W.v2FilesFrom({ agents: {}, patches: {}, messages: {} }).timeline(state)).toBeNull()
})

// ---------------------------------------------------------------------------
// The pane's drawings (hooks/ui/v2/timeline.tsx).

/** A run of `agents` lanes over two hours, each with `calls` calls: more than the pane may draw. */
function bigTimeline(agents: number, calls: number): T.V2Timeline {
  const span = 2 * 3_600_000
  return {
    v: 2,
    now: NOW + span,
    startedAt: NOW,
    tools: ['Read', 'Bash'],
    lanes: Array.from({ length: agents }, (_, i) => ({
      id: i === 0 ? 'main' : `agent-${i}`,
      title: i === 0 ? 'Orchestrator' : `agent number ${i} with a long name`,
      parent: i === 0 ? null : 'main',
      depth: i === 0 ? 0 : 1,
      kind: i === 0 ? ('orchestrator' as const) : ('agent' as const),
      status: 'running' as const,
      isStopped: false,
      start: i * 60_000,
      end: null,
      outcome: null,
      spans: [{ kind: 'work' as const, from: i * 60_000, to: null }],
      ticks: Array.from({ length: calls }, (_, k): T.V2Tick => [i * 60_000 + k * 15_000, 400, k % 2, k % 50 === 0 ? 0 : 1]),
    })),
    marks: [{ at: 0, id: 'm1', text: 'Go' }],
    messages: [],
    background: [],
  }
}

test('the desktop`s image keeps under the pane`s bounds: 40 lanes at most, ticks thinned to the pixels there are, a failed one always kept', () => {
  const timeline = bigTimeline(80, 400)
  for (const columns of [64, 84, 160]) {
    const image = timelineSvgOf(timeline, timeline.lanes.slice(0, MOST_LANES), columns * 7.85)
    expect(image.width).toBeLessThanOrEqual(Math.max(320, columns * 7.85))
    expect(image.svg.length).toBeLessThan(150_000)
    expect(image.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  }
  const small = timelineSvgOf(bigTimeline(3, 10), bigTimeline(3, 10).lanes, 600)
  for (const words of ['>now<', '>0m<', 'working', 'a tool call', 'you wrote', 'started by']) expect(small.svg).toContain(words)
  expect(small.svg).not.toContain('waiting on you')
})

test('the terminal`s lanes: a cell a slice of the run, waiting over working over idle, the outcome where its run ended, your prompt as ◆; the axis from 0m to now', () => {
  const lane: T.V2Lane = {
    id: 'a',
    title: 'a',
    parent: 'main',
    depth: 1,
    kind: 'agent',
    status: 'done',
    isStopped: false,
    start: 0,
    end: 60_000,
    outcome: 'done',
    spans: [
      { kind: 'work', from: 0, to: 20_000 },
      { kind: 'idle', from: 20_000, to: 30_000 },
      { kind: 'work', from: 30_000, to: 60_000 },
      { kind: 'wait', from: 40_000, to: 50_000 },
    ],
    ticks: [],
  }
  const cells = laneCellsOf(lane, 12, 120_000, [{ at: 0 }])
  expect(cells.map(cell => cell.ch).join('')).toBe('◆━┄━━●      ')
  expect([cells[3]?.color, cells[4]?.color, cells[2]?.color]).toEqual(['#3b82f6', '#f59e0b', '#737373'])
  const failed = laneCellsOf({ ...lane, outcome: 'failed' }, 12, 120_000)
  expect(failed.map(cell => cell.ch).join('').trimEnd()).toBe('━━┄━━✕')
  expect(axisLineOf(40 * MIN, 64)).toMatch(/^0m +5m +10m +15m +20m +25m +30m +35m +now$/)
  expect(Array.from(axisLineOf(40 * MIN, 64))).toHaveLength(64)
})

/** The deck's pane, `bodyColumns` across, on `surface`. */
function pane<S extends 'terminal' | 'desktop' | 'vscode' | 'mobile'>(surface: S, bodyColumns = 84) {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId: 'agent-deck',
    viewport: { columns: bodyColumns + 4, rows: 400, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} },
  }
}

type Drawing = {
  press: (target: { key: string }) => Promise<unknown>
  redraw: () => Promise<void>
  drawn: () => Promise<unknown>
  find: (q: { key?: string; type?: string }) => Promise<{ text: string; props: Record<string, unknown>; children: unknown[] } | undefined>
  findAll: (q: { type?: string; key?: string }) => Promise<{ key?: string; text: string; props: Record<string, unknown> }[]>
  unmount: () => Promise<void>
}

async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

/** `/deck demo` over the v2 sample, its timeline.json `timeline`. */
async function demo($: Engine, on: On, timeline: T.V2Timeline | null = null): Promise<World> {
  mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const text = T.timelineTextOf(timeline ?? T.timelineOf(session.data, state))
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(state) }
    if (path.endsWith('/web/fixtures/v2/timeline.json')) return { value: text }
    return { deny: 'no such file' }
  })
  on('ui.focus', () => ({}))
  const w = newWorld()
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  return w
}

/** A drawing's elements, as the desktop counts them: every element and every string. */
function countOf(node: unknown): number {
  if (typeof node === 'string' || typeof node === 'number') return 1
  if (!node || typeof node !== 'object') return 0
  return 1 + ((node as { children?: unknown[] }).children ?? []).reduce((sum: number, kid) => sum + countOf(kid), 0)
}

test('Org`s head has the Chart · Timeline switch; the Timeline on the desktop is one plain image with each agent`s name under it opening its page, the pick kept', async ($, on) => {
  await demo($, on)
  const ui = (await $.ui.mount(pane('desktop'))) as unknown as Drawing
  await press(ui, 'tab:org')
  expect((await ui.find({ key: 'org:show:chart' }))?.props).toMatchObject({ label: 'Chart', plain: true, dimColor: false })
  expect((await ui.find({ key: 'org:show:timeline' }))?.props).toMatchObject({ label: 'Timeline', plain: true, dimColor: true })
  await press(ui, 'org:show:timeline')
  expect((await ui.find({ key: 'org:show:timeline' }))?.props.dimColor).toBe(false)
  expect(await ui.find({ key: 'org:chart' })).toBeUndefined()
  const image = await ui.find({ key: 'org:timeline:image' })
  const svg = (await ui.findAll({ type: 'Svg' })).find(one => String(one.props.alt).startsWith('The timeline'))
  expect(image).toBeDefined()
  expect(svg?.props).toMatchObject({ width: Math.floor(83 * 7.85) - 4 })
  expect(svg?.props.isInteractive).toBeUndefined()
  expect((await ui.findAll({ type: 'Text' })).some(one => one.text === '40m · 8 agents')).toBe(true)
  // each name under it opens its page
  const names = (await ui.findAll({ type: 'Button' })).filter(one => (one.key ?? '').startsWith('agent:')).map(one => one.props.label)
  expect(names).toEqual(['Orchestrator', 'researcher', 'builder', 'tester', 'Lint the new files', 'docs', 'scout', 'reviewer'])
  await press(ui, W.agentKeyOf(IDS.reviewer))
  expect((await ui.find({ key: 'page:head' }))?.text).toContain('reviewer')
  await press(ui, 'key:b')
  // the pick stays: back on the Dashboard and on Org again, the Timeline
  await press(ui, 'tab:now')
  await press(ui, 'tab:org')
  expect(await ui.find({ key: 'org:timeline:image' })).toBeDefined()
  await press(ui, 'org:show:chart')
  expect(await ui.find({ key: 'org:chart' })).toBeDefined()
  await ui.unmount()
})

test('the desktop`s Timeline of a run too large keeps under the Desktop`s bounds: 40 lanes, then "N more"; under 2000 elements and its characters', async ($, on) => {
  await demo($, on, bigTimeline(80, 400))
  const ui = (await $.ui.mount(pane('desktop'))) as unknown as Drawing
  await press(ui, 'tab:org')
  await press(ui, 'org:show:timeline')
  const drawn = await ui.drawn()
  expect(countOf(drawn)).toBeLessThan(2000)
  expect(JSON.stringify(drawn).length).toBeLessThan(262_144)
  expect(JSON.stringify(drawn)).toContain('40 more agents: more than the pane holds. /deck web shows them all.')
  await ui.unmount()
})

test('the terminal`s Timeline: text lanes fitted to its columns under a time axis, each name a Button to its page; ━ in blue at work and amber waiting, ┄ idle, ● done, ✕ failed', async ($, on) => {
  await demo($, on)
  for (const columns of [84, 60]) {
    const ui = (await $.ui.mount(pane('terminal', columns))) as unknown as Drawing
    await press(ui, 'tab:org')
    await press(ui, 'org:show:timeline')
    expect(await ui.findAll({ type: 'Svg' })).toEqual([])
    const lanes = await ui.find({ key: 'org:timeline:lanes' })
    expect(lanes).toBeDefined()
    const axis = (await ui.findAll({ type: 'Text' })).find(one => /^0m /.test(one.text))!
    const cells = Array.from(axis.text).length
    expect(axis.text.endsWith('now')).toBe(true)
    for (const id of ['main', IDS.researcher, IDS.builder, IDS.tester, IDS.linter, IDS.docs, IDS.scout, IDS.reviewer]) {
      const row = (await ui.find({ key: `tl:${id}` }))!
      const name = String((await ui.find({ key: W.agentKeyOf(id) }))?.props.label)
      // the name's column, then the lane: never past the pane's columns
      expect(Array.from(row.text.slice(name.length))).toHaveLength(cells)
      expect(cells + Math.min(18, Math.max(8, Math.floor((columns - 1) * 0.24))) + 1).toBeLessThanOrEqual(columns)
    }
    const text = lanes!.text
    for (const glyph of ['━', '┄', '●', '✕', '■', '◆']) expect(text).toContain(glyph)
    const colours = new Set((await ui.findAll({ type: 'Text' })).filter(one => /^━+$/.test(one.text)).map(one => one.props.color))
    expect([...colours].sort()).toEqual(['#3b82f6', '#f59e0b'])
    await press(ui, W.agentKeyOf(IDS.tester))
    expect((await ui.find({ key: 'page:head' }))?.text).toContain('tester')
    await press(ui, 'key:b')
    await ui.unmount()
  }
})

// ---------------------------------------------------------------------------
// The live deck: its turns kept, and timeline.json beside the state.

test('while the web deck is on, timeline.json is written beside the state from the live run, before it, and again only when it changed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  await $.command.run(deck('web'))
  await clock.advance(400)
  const written = () => w.writes.filter(one => /[\\/]timeline\.json$/.test(one.path))
  const first = JSON.parse(written().at(-1)!.text) as T.V2Timeline
  expect(first.lanes.map(lane => [lane.id, lane.title])).toEqual([
    ['main', 'Orchestrator'],
    ['agent-x1', 'scout'],
  ])
  expect(first.lanes[0]?.spans).toEqual([{ kind: 'work', from: 0, to: null }])
  expect(first.marks.map(mark => mark.text)).toEqual(['Fix the off-by-one in src/range.js'])
  // its order: the timeline, then the state that follows it
  const at = (pattern: RegExp) => w.writes.findIndex(one => pattern.test(one.path))
  expect(at(/timeline\.json$/)).toBeLessThan(at(/state\.json$/))
  // the turn ends: one turn kept, idle after it
  await clock.advance(MIN)
  await $.turn.complete({ turnId: 't1', answer: 'Started scout.', durationMs: 60_000, isAborted: false, reason: 'answer' })
  await clock.advance(400)
  const ended = JSON.parse(written().at(-1)!.text) as T.V2Timeline
  expect(ended.lanes[0]?.spans).toEqual([
    { kind: 'work', from: 0, to: MIN + 400 },
    { kind: 'idle', from: MIN + 400, to: null },
  ])
  // nothing new: not written again
  const count = written().length
  await clock.advance(6000)
  expect(written()).toHaveLength(count)
})
