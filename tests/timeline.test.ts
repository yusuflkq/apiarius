/**
 * Org's Timeline: what the model keeps of each loop beyond its own fields
 * (hooks/lane.ts: its calls past the newest 14, the runs it ended before it
 * ran again, the Orchestrator's turns, its waits on you, the background
 * tasks it started that ended), the view model built from it
 * (hooks/timeline.ts, timeline.json), how every surface lays it out
 * (web/timeline.mjs: the folded axis, the segments and their names, the
 * messages' marks, the rows), and the pane's two drawings of it
 * (hooks/ui/v2/timeline.tsx): the desktop's rows of its own elements, each
 * lane a small image, under the pane's bounds; the terminal's rows in cells
 * fitted to its columns. Every span, tick and mark is a time Claude Code
 * reported; what the deck does not know is not drawn.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as B from '../hooks/background'
import type { V2BackgroundRow } from '../hooks/background'
import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import * as T from '../hooks/timeline'
import { MOST_LANES, axisLineOf, axisSpanOf, backgroundCellsOf, laneCellsOf, timelineSummaryOf } from '../hooks/ui/v2/timeline'
import * as W from '../hooks/web'
import * as Lanes from '../web/timeline.mjs'
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
  // Claude Code saying a loop is idle is no wait
  M.noteNotification(data, { type: 'idle_prompt', message: 'Claude is waiting for your input', agent: helper.id, at: NOW + 8.5 * MIN })
  expect(helper.lane?.waits).toHaveLength(1)
  // Claude Code's notification about no call in particular ends when the loop moves on (its next call), as the deck's need does
  M.noteNotification(data, { type: 'elicitation_dialog', message: 'The github MCP server is asking for your input', agent: helper.id, at: NOW + 9 * MIN })
  expect(helper.lane?.waits.at(-1)).toEqual({ kind: 'note', from: NOW + 9 * MIN })
  call(data, helper, 'toolu_h2', NOW + 10 * MIN, 100)
  expect(helper.lane?.waits.at(-1)?.to).toBe(NOW + 10 * MIN)
})

test('the Orchestrator`s turns: each kept as it ends; one whose end never came ran until the deck last heard from it; its notifications end when its next turn starts', () => {
  const data = M.emptyData(NOW)
  const main = M.agentOf(data, M.MAIN)!
  M.noteMainTurn(data, 't1', NOW)
  M.endMainTurn(data, 't1', NOW + 2 * MIN)
  M.noteNotification(data, { type: 'elicitation_dialog', message: 'The github MCP server is asking for your input', at: NOW + 3 * MIN })
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

test('the sample`s timeline: a lane an agent in the tree`s order, the Orchestrator first; its turns with idle between, its waits on you, each outcome, your prompts, messages between agents, each background task by the loop that started it', () => {
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
  // the background tasks the deck saw start, from their call to now, each by the loop whose call started it: builder's dev server, the
  // Orchestrator's CI monitor; never the test watcher first seen in Claude Code's snapshot (when it started is not known), the wakeup or the cron
  expect(timeline.background).toEqual([
    { id: 'bash_7', title: 'Start the dev server', what: 'Shell · npm run dev', by: IDS.builder, start: ago(18) - ago(40), end: null },
    { id: 'mon_2', title: 'CI checks on PR 42', what: 'Monitor', by: 'main', start: ago(3.5) - ago(40), end: null },
  ])
  expect(timelineSummaryOf(timeline)).toBe('40m · 8 agents · 2 in the background · 2 messages')
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
  // background lanes: none with nothing in the background; then a lane each task whose call the deck saw start, from that call to now,
  // never one first seen in Claude Code's snapshot (no start known), nor a schedule
  expect(T.timelineOf(data, state).background).toEqual([])
  const row = (id: string, kind: V2BackgroundRow['kind'], by: string | null, title: string, what: string): V2BackgroundRow => ({
    id,
    kind,
    what,
    title,
    status: kind === 'cron' ? 'scheduled' : 'running',
    by,
    byName: by === null ? '' : 'Orchestrator',
    at: NOW + MIN,
    nextAt: null,
    schedule: kind === 'cron' ? '0 9 * * 1-5' : '',
    recurring: kind === 'cron',
    when: '',
    stop: null,
  })
  const rows = [row('bash_1', 'shell', M.MAIN, 'npm run dev', 'Shell · Start the dev server'), row('bash_2', 'shell', null, 'npx vitest --watch', 'Shell'), row('cron_1', 'cron', M.MAIN, 'Summarise the PRs', 'Cron · Every weekday at 9:00')]
  const busy: W.WebStateV2 = { ...state, background: { rows, tasks: 2, scheduled: 1, text: '2 shells · 1 scheduled' } }
  expect(T.timelineOf(data, busy).background).toEqual([{ id: 'bash_1', title: 'npm run dev', what: 'Shell · Start the dev server', by: 'main', start: MIN, end: null }])
})

test('a background task that ended keeps its lane under the loop that started it, to the moment Claude Code said it ended (its notification, the TaskStop that stopped it, the first snapshot that no longer lists it); one that never ran in the background is none', () => {
  const data = M.emptyData(NOW)
  M.noteMainTurn(data, 't1', NOW)
  const one = spawned(data, 'agent-a1', 'builder', NOW)
  const shell = (id: string, task: string, by: string, at: number, command: string, description: string) => {
    const input = { command, description, run_in_background: true }
    B.noteStart(data, { toolUseId: id, tool: 'Bash', input, by, at })
    B.noteEnd(data, { toolUseId: id, tool: 'Bash', input, by, at, ok: true, result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: task } })
  }
  shell('t1', 'bash_1', one.id, NOW + 2 * MIN, 'node web/dev.js', 'Start the web dev server')
  shell('t2', 'bash_2', M.MAIN, NOW + 3 * MIN, 'npm run watch', 'Watch the build')
  shell('t3', 'bash_3', one.id, NOW + 4 * MIN, 'npx tsc -w', 'Typecheck as it changes')
  shell('t4', 'bash_4', M.MAIN, NOW + 5 * MIN, 'node --test --watch web/test/', 'Watch the web tests')
  // a shell that ran in the foreground after all: no task, no lane
  B.noteStart(data, { toolUseId: 't5', tool: 'Bash', input: { command: 'npm test', run_in_background: true }, by: one.id, at: NOW + 6 * MIN })
  B.noteEnd(data, { toolUseId: 't5', tool: 'Bash', input: { command: 'npm test', run_in_background: true }, by: one.id, at: NOW + 6 * MIN, ok: true, result: { stdout: 'ok', stderr: '', interrupted: false } })
  // Claude Code says bash_1 completed; the Orchestrator's TaskStop stops bash_2; a snapshot no longer lists bash_3
  expect(B.noteTaskEnds(data, '<task-notification><task-id>bash_1</task-id><status>completed</status><summary>Done</summary></task-notification>', NOW + 10 * MIN)).toBe(true)
  expect(B.noteEnd(data, { toolUseId: 's1', tool: 'TaskStop', input: { task_id: 'bash_2' }, by: M.MAIN, at: NOW + 12 * MIN, ok: true, result: { message: 'stopped', task_id: 'bash_2', task_type: 'local_bash' } })).toBe(true)
  B.noteSnapshot(data, { tasks: [{ id: 'bash_4', type: 'shell', status: 'running', description: 'Watch the web tests', command: 'node --test --watch web/test/' }], at: NOW + 14 * MIN, agents: new Set() })
  expect(B.rowsOf(data).map(row => row.id)).toEqual(['bash_4'])
  expect(one.lane?.background).toEqual([
    { id: 'bash_1', title: 'Start the web dev server', what: 'Shell · node web/dev.js', from: NOW + 2 * MIN, to: NOW + 10 * MIN },
    { id: 'bash_3', title: 'Typecheck as it changes', what: 'Shell · npx tsc -w', from: NOW + 4 * MIN, to: NOW + 14 * MIN },
  ])
  // the timeline: each under its starter, as they started; the one still listed to now
  const { timeline } = built(data, NOW + 20 * MIN)
  expect(timeline.background.map(bg => [bg.id, bg.by, bg.start / MIN, bg.end === null ? null : bg.end / MIN])).toEqual([
    ['bash_1', one.id, 2, 10],
    ['bash_2', M.MAIN, 3, 12],
    ['bash_3', one.id, 4, 14],
    ['bash_4', M.MAIN, 5, null],
  ])
  expect(Lanes.rowsOf(timeline.lanes, timeline.background).map(row => (row.kind === 'lane' ? row.lane.id : `└ ${row.bg.id}`))).toEqual(['main', '└ bash_2', '└ bash_4', one.id, '└ bash_1', '└ bash_3'])
  // kept through a snapshot of the deck, each part in its own shape
  expect(M.agentOf(M.healData(M.copyOf(data), NOW), one.id)?.lane?.background).toEqual(one.lane?.background)
  const odd = M.copyOf(data)
  M.agentOf(odd, one.id)!.lane!.background!.push({ id: 'x', title: 3 } as never)
  expect(M.agentOf(M.healData(odd, NOW), one.id)?.lane?.background).toHaveLength(2)
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
// How every surface lays it out (web/timeline.mjs).

test('folding: every stretch of 20 minutes or more where nobody worked or waited on you folds to a break, after the last work too; open time keeps its pace across the room; the axis says how long each break is, the times either side, and the round times between, none over another', () => {
  const lanes = [
    { spans: [{ kind: 'work' as const, from: 0, to: 6 * MIN }, { kind: 'idle' as const, from: 6 * MIN, to: 176 * MIN }, { kind: 'work' as const, from: 176 * MIN, to: 182 * MIN }] },
    { spans: [{ kind: 'work' as const, from: 179 * MIN, to: 200 * MIN }, { kind: 'wait' as const, from: 205 * MIN, to: 230 * MIN }] },
  ]
  const span = 260 * MIN
  const folds = Lanes.foldsOf(lanes, span)
  expect(folds).toEqual([
    { from: 6 * MIN, to: 176 * MIN },
    { from: 230 * MIN, to: 260 * MIN },
  ])
  // under 20 minutes never folds; a run to now is work to the end; nobody at work, nothing folds
  expect(Lanes.foldsOf([{ spans: [{ kind: 'work', from: 0, to: MIN }, { kind: 'work', from: 21 * MIN - 1, to: 22 * MIN }] }], 22 * MIN)).toEqual([])
  expect(Lanes.foldsOf([{ spans: [{ kind: 'work', from: 0, to: MIN }, { kind: 'work', from: 21 * MIN, to: null }] }], 90 * MIN)).toEqual([{ from: MIN, to: 21 * MIN }])
  expect(Lanes.foldsOf([{ spans: [{ kind: 'idle', from: 0, to: null }] }], 60 * MIN)).toEqual([])
  // the axis: the hour of open time evenly over the room less the breaks
  const axis = Lanes.axisOf(span, folds, 1200, 72)
  const per = (1200 - 144) / 60
  const at = (ms: number) => Math.round(axis.x(ms) * 1000) / 1000
  expect(at(0)).toBe(0)
  expect(at(6 * MIN)).toBe(Math.round(6 * per * 1000) / 1000)
  expect(axis.x(100 * MIN)).toBeGreaterThan(6 * per)
  expect(axis.x(100 * MIN)).toBeLessThan(6 * per + 72)
  expect(at(182 * MIN)).toBe(Math.round((12 * per + 72) * 1000) / 1000)
  expect(at(span)).toBe(1200)
  expect(axis.folds.map(one => [Math.round(one.x0), Math.round(one.x1)])).toEqual([
    [Math.round(6 * per), Math.round(6 * per + 72)],
    [Math.round(60 * per + 72), 1200],
  ])
  expect(Lanes.isFolded(axis, 100 * MIN)).toBe(true)
  expect(Lanes.isFolded(axis, 6 * MIN)).toBe(false)
  // the breaks take a third of the room at most
  expect(Lanes.axisOf(span, folds, 120, 72).gap).toBe(20)
  // its words: the start, the first break's edges and length, round times, now; never one over another
  const startedAt = new Date(2026, 9, 29, 13, 30).getTime()
  const words = Lanes.axisWordsOf(axis, startedAt, text => Array.from(text).length * 6, 6)
  expect(words.slice(0, 5).map(word => `${word.kind}:${word.text}`)).toEqual(['start:13:30', 'edge:13:36', 'fold:⋯ 2h 50m', 'edge:16:26', 'tick:16:30'])
  expect(words.at(-1)).toMatchObject({ kind: 'now', text: 'now', x: 1200, align: 'end' })
  const boxes = words.map(word => {
    const w = Array.from(word.text).length * 6
    const left = word.align === 'start' ? word.x : word.align === 'end' ? word.x - w : word.x - w / 2
    return [left, left + w]
  })
  boxes.forEach((box, i) => i > 0 && expect(box[0]).toBeGreaterThanOrEqual((boxes[i - 1]?.[1] ?? 0) + 6 - 0.001))
  expect(words.filter(word => word.kind === 'tick').every(word => !Lanes.isFolded(axis, 0) && /^\d\d:\d[05]$/.test(word.text))).toBe(true)
  expect([Lanes.lengthOf(170 * MIN), Lanes.lengthOf(45 * MIN), Lanes.lengthOf(120 * MIN)]).toEqual(['2h 50m', '45m', '2h'])
})

test('a lane`s calls as segments: calls of one tool back to back one segment with their count, a failed one its own, the newest running to now; those touching where they are drawn one of more tools; named where the name fits ("Read ×10" on the web), a mixed one by the tool that holds most of it', () => {
  const axis = Lanes.axisOf(10 * MIN, [], 600, 0)
  const calls = [
    ...Array.from({ length: 10 }, (_, i) => ({ at: i * 20_000, ms: 5000, tool: 'Read', how: 1 })),
    { at: 200_000, ms: 3000, tool: 'Edit', how: 1 },
    { at: 210_000, ms: 1000, tool: 'Edit', how: 0 },
    { at: 215_000, ms: 1000, tool: 'Edit', how: 1 },
    { at: 300_000, ms: -1, tool: 'Bash', how: -1 },
  ]
  const segments = Lanes.segmentsOf(calls, axis, { liveTo: 10 * MIN, min: 2, join: 2 })
  expect(segments.map(one => [one.tool, one.count, one.failed, one.running])).toEqual([
    ['Read', 10, false, false],
    ['Edit', 1, false, false],
    ['Edit', 1, true, false],
    ['Edit', 1, false, false],
    ['Bash', 1, false, true],
  ])
  expect(segments[0]).toMatchObject({ from: 0, to: 185_000, x0: 0, x1: 185 })
  expect(segments[4]).toMatchObject({ from: 300_000, to: 600_000, x0: 300, x1: 600 })
  // a call whose end was not seen, and not the newest of a lane at work, ends where it began, drawn `min` across
  expect(Lanes.segmentsOf([{ at: 0, ms: -1, tool: 'Grep', how: -1 }, { at: 120_000, ms: 1000, tool: 'Read', how: 1 }], axis, { min: 3 })[0]).toMatchObject({ to: 0, x1: 3, running: false })
  // narrow, the calls that touch are one segment, each tool counted
  const narrow = Lanes.axisOf(10 * MIN, [], 60, 0)
  const mixed = Lanes.segmentsOf([0, 10_000, 20_000].map(at => ({ at, ms: 5000, tool: 'Read', how: 1 })).concat([{ at: 30_000, ms: 2000, tool: 'Edit', how: 1 }, { at: 40_000, ms: 2000, tool: 'Read', how: 1 }]), narrow, { min: 2, join: 2 })
  expect(mixed).toHaveLength(1)
  expect(mixed[0]).toMatchObject({ tool: '', count: 5, tools: { Read: 4, Edit: 1 } })
  expect(Lanes.toolsText(mixed[0]!)).toBe('Read ×4, Edit')
  // names: the tool's (with its count, rich) where it fits, else the tool's alone, else none
  const w = (text: string) => Array.from(text).length * 6
  expect(Lanes.segmentLabel(segments[0]!, 185, w, true)).toBe('Read ×10')
  expect(Lanes.segmentLabel(segments[0]!, 185, w)).toBe('Read')
  expect(Lanes.segmentLabel(segments[0]!, 40, w, true)).toBe('Read')
  expect(Lanes.segmentLabel(segments[0]!, 20, w, true)).toBe('')
  expect(Lanes.segmentLabel(mixed[0]!, 100, w, true)).toBe('Read ×4')
  expect(Lanes.segmentLabel({ ...mixed[0]!, tools: { Read: 2, Edit: 2, Bash: 1 } }, 100, w, true)).toBe('')
})

test('messages: numbered oldest first among the rows drawn, each an arrow out of its sender`s row and into its receiver`s, a line through the rows between (a shell`s too); one to or from a row not drawn takes no number', () => {
  const ids = ['main', 'bg:b1', 'a', 'b']
  const messages = [
    { at: 1, from: 'a', to: 'main' },
    { at: 2, from: 'main', to: 'b' },
    { at: 3, from: 'gone', to: 'a' },
    { at: 4, from: 'b', to: 'a' },
  ]
  expect(Lanes.numberedOf(ids, messages).map(one => [one.n, one.from, one.to])).toEqual([
    [1, 'a', 'main'],
    [2, 'main', 'b'],
    [3, 'b', 'a'],
  ])
  const crossings = Lanes.crossingsOf(ids, messages)
  expect(crossings[0]).toEqual([
    { at: 1, n: 1, role: 'to', down: false },
    { at: 2, n: 2, role: 'from', down: true },
  ])
  expect(crossings[1]).toEqual([
    { at: 1, n: 1, role: 'pass', down: false },
    { at: 2, n: 2, role: 'pass', down: true },
  ])
  expect(crossings[2]).toEqual([
    { at: 1, n: 1, role: 'from', down: false },
    { at: 2, n: 2, role: 'pass', down: true },
    { at: 4, n: 3, role: 'to', down: false },
  ])
  expect(crossings[3]).toEqual([
    { at: 2, n: 2, role: 'to', down: true },
    { at: 4, n: 3, role: 'from', down: false },
  ])
})

test('rows: each lane, then the background tasks its loop started as they started, those whose starter is not drawn last; with too many, the Orchestrator and the newest to start, in their order', () => {
  const lane = (id: string, start: number) => ({ id, start })
  const bg = (id: string, by: string, start: number) => ({ id, by, start })
  const rows = Lanes.rowsOf([lane('main', 0), lane('a', 5), lane('b', 9)], [bg('x', 'a', 7), bg('y', 'main', 8), bg('z', 'gone', 1), bg('w', 'a', 6)])
  expect(rows.map(row => (row.kind === 'lane' ? row.lane.id : `bg:${row.bg.id}`))).toEqual(['main', 'bg:y', 'a', 'bg:w', 'bg:x', 'b', 'bg:z'])
  const many = Array.from({ length: 30 }, (_, i) => lane(i === 0 ? 'main' : `a${i}`, i))
  const newest = Lanes.newestOf(many, 20)
  expect(newest.more).toBe(10)
  expect(newest.lanes.map(one => one.id)).toEqual(['main', ...Array.from({ length: 19 }, (_, i) => `a${i + 11}`)])
  expect(Lanes.newestOf(many.slice(0, 5), 20)).toEqual({ lanes: many.slice(0, 5), more: 0 })
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
    messages: Array.from({ length: 30 }, (_, k) => ({ at: k * 60_000, from: 'main', to: `agent-${79 - k}`, id: `msg${k}`, title: `Message ${k}` })),
    background: [],
  }
}

/** Today's run as Org draws it: the Orchestrator works 6 minutes, nobody works for 2h 50m, then builder and reviewer; messages, a shell each. */
function longTimeline(): T.V2Timeline {
  return {
    v: 2,
    now: SAMPLE_NOW,
    startedAt: SAMPLE_NOW - 231 * MIN,
    tools: ['Read', 'Edit', 'Bash'],
    lanes: [
      {
        id: 'main',
        title: 'Orchestrator',
        parent: null,
        depth: 0,
        kind: 'orchestrator',
        status: 'running',
        isStopped: false,
        start: 0,
        end: null,
        outcome: null,
        spans: [
          { kind: 'work', from: 0, to: 6 * MIN },
          { kind: 'work', from: 176 * MIN, to: null },
          { kind: 'idle', from: 6 * MIN, to: 176 * MIN },
        ],
        ticks: [
          [MIN, 20_000, 0, 1],
          [177 * MIN, 30_000, 2, 1, 'git status'],
        ],
      },
      {
        id: IDS.builder,
        title: 'builder',
        parent: 'main',
        depth: 1,
        kind: 'agent',
        status: 'done',
        isStopped: false,
        start: 179 * MIN,
        end: 222 * MIN,
        outcome: 'done',
        spans: [{ kind: 'work', from: 179 * MIN, to: 222 * MIN }],
        ticks: [...Array.from({ length: 10 }, (_, i): T.V2Tick => [180 * MIN + i * 20_000, 15_000, 0, 1]), [195 * MIN, 60_000, 1, 1], [200 * MIN, 30_000, 2, 0, 'npm test'], [205 * MIN, 600_000, 1, 1, 'src/app.ts']],
      },
      {
        id: IDS.reviewer,
        title: 'reviewer',
        parent: 'main',
        depth: 1,
        kind: 'agent',
        status: 'waiting',
        isStopped: false,
        start: 190 * MIN,
        end: null,
        outcome: null,
        spans: [
          { kind: 'work', from: 190 * MIN, to: null },
          { kind: 'wait', from: 220 * MIN, to: null },
        ],
        ticks: [[191 * MIN, 5000, 0, 1]],
      },
    ],
    marks: [
      { at: 0, id: 'p1', text: 'Fix the bugs' },
      { at: 176 * MIN, id: 'p2', text: 'Merge them' },
    ],
    messages: [
      { at: 200 * MIN, from: IDS.builder, to: 'main', id: 'm1', title: 'Should an idle prompt count?' },
      { at: 210 * MIN, from: 'main', to: IDS.reviewer, id: 'm2', title: 'Review the fix' },
    ],
    background: [
      { id: 'bash_9', title: 'Start the web dev server', what: 'Shell · node web/dev.js', by: IDS.builder, start: 186 * MIN, end: 222 * MIN },
      { id: 'bash_8', title: 'Watch the web tests', what: 'Shell · node --test --watch', by: 'main', start: 191 * MIN, end: null },
    ],
  }
}

test('the axis runs to now, a long run`s to its whole minute: within it a lane`s image is the one made before', () => {
  expect(axisSpanOf({ startedAt: 0, now: 3 * 3_600_000 + 59_000 })).toBe(3 * 3_600_000)
  expect(axisSpanOf({ startedAt: 0, now: 25 * MIN + 7000 })).toBe(25 * MIN)
  expect(axisSpanOf({ startedAt: 0, now: 5 * MIN + 7500 })).toBe(5 * MIN + 7000)
  expect(axisSpanOf({ startedAt: 0, now: 2000 })).toBe(MIN)
})

test('the terminal`s cells: a call a run on its colour (its tool`s name where it fits), a failed one ✕ on red, waiting on you amber, ─ thinking, ┄ idle, your prompt ◆, ✓ after its end, a message ↓; a shell ━ to its end ■; the axis its times and ╱ where it folds', () => {
  const timeline = { ...longTimeline(), tools: ['Read', 'Edit'] }
  const lane: T.V2Lane = {
    id: 'main',
    title: 'Orchestrator',
    parent: null,
    depth: 0,
    kind: 'orchestrator',
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
    ticks: [
      [0, 15_000, 0, 1],
      [32_000, 6000, 1, 0],
    ],
  }
  const axis = Lanes.axisOf(120_000, [], 24, 3)
  const cells = laneCellsOf({ ...timeline, marks: [{ at: 0, id: 'p', text: 'Go' }] }, lane, axis, [{ at: 55_000, n: 1, role: 'from', down: true }])
  expect(cells.map(cell => cell.ch).join('')).toBe(`◆  ─┄┄✕   ─↓✓${' '.repeat(11)}`)
  expect(cells.map(cell => cell.bg ?? '.').slice(0, 10)).toEqual(['.', '#1d4ed8', '#1d4ed8', '.', '.', '.', '#991b1b', '#991b1b', '#b45309', '#b45309'])
  // wide enough, a segment says its tool
  const wide = laneCellsOf(timeline, { ...lane, id: 'a', spans: [{ kind: 'work', from: 0, to: 60_000 }], ticks: [[0, 30_000, 0, 1]] }, Lanes.axisOf(60_000, [], 20, 3))
  expect(wide.map(cell => cell.ch).join('')).toBe('Read      ─────────✓')
  expect(wide[0]).toEqual({ ch: 'R', color: '#ffffff', bg: '#1d4ed8' })
  // a shell from its call to its end
  const shell = backgroundCellsOf({ id: 'b', title: 'Start the server', what: 'Shell', by: 'main', start: 30_000, end: 90_000 }, axis)
  expect(shell.map(cell => cell.ch).join('').trimEnd()).toBe(`${' '.repeat(6)}━━━━━━━━━━━■`)
  // the axis: the start's time, ╱ where it folds, now at its end
  const long = longTimeline()
  const line = axisLineOf(Lanes.axisOf(231 * MIN, Lanes.foldsOf(long.lanes, 231 * MIN), 60, 3), long.startedAt)
  expect(Array.from(line)).toHaveLength(60)
  expect(line).toContain('╱╱╱')
  expect(line.endsWith('now')).toBe(true)
  expect(line.startsWith(Lanes.clockOf(long.startedAt))).toBe(true)
})

/** The deck's pane, `bodyColumns` across, on `surface`. */
function pane<S extends 'terminal' | 'desktop' | 'vscode' | 'mobile'>(surface: S, bodyColumns = 84) {
  return {
    plugin: 'apiarius',
    surface,
    component: 'Pane' as const,
    requestId: 'apiarius',
    viewport: { columns: bodyColumns + 4, rows: 400, isFullscreen: true },
    props: { title: 'Apiarius', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} },
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

/** `/apiarius demo` over the v2 sample, its timeline.json `timeline`. */
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

test('Org`s head has the Chart · Timeline switch; the Timeline on the desktop is a row an agent (its face, its name the Button that opens its page, its word, what it does) beside its lane, a small image; the shells under their starters; a legend; the messages listed; the pick kept', async ($, on) => {
  await demo($, on)
  const ui = (await $.ui.mount(pane('desktop'))) as unknown as Drawing
  await press(ui, 'tab:org')
  expect((await ui.find({ key: 'org:show:chart' }))?.props).toMatchObject({ label: 'Chart', plain: true, dimColor: false })
  expect((await ui.find({ key: 'org:show:timeline' }))?.props).toMatchObject({ label: 'Timeline', plain: true, dimColor: true })
  await press(ui, 'org:show:timeline')
  expect((await ui.find({ key: 'org:show:timeline' }))?.props.dimColor).toBe(false)
  expect(await ui.find({ key: 'org:chart' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text' })).some(one => one.text === '40m · 8 agents · 2 in the background · 2 messages')).toBe(true)
  // a row an agent: its name the Button that opens it (no strip of "Open" under the chart), its word, what it does now or did last
  const names = (await ui.findAll({ type: 'Button' })).filter(one => (one.key ?? '').startsWith('agent:')).map(one => one.props.label)
  expect(names).toEqual(['Orchestrator', 'researcher', 'builder', 'tester', 'Lint the new files', 'docs', 'scout', 'reviewer'])
  expect((await ui.findAll({ type: 'Text' })).some(one => one.text === 'Open')).toBe(false)
  const researcher = (await ui.find({ key: `tl:${IDS.researcher}` }))!
  expect(researcher.text).toMatch(/^researcherdoneDone \d+m ago: “Found 14 public routes/)
  expect((await ui.find({ key: `tl:${IDS.linter}` }))?.text).toMatch(/^Lint the new filesfailedFailed \d+m ago/)
  // its lane a plain image beside it, every lane on one axis, as wide as the pane leaves it
  const svgs = await ui.findAll({ type: 'Svg' })
  const lanes = svgs.filter(one => /'s lane: /.test(String(one.props.alt)))
  expect(lanes.map(one => String(one.props.alt).split("'s lane")[0])).toEqual(names)
  expect(lanes.every(one => one.props.isInteractive === undefined && one.props.width === lanes[0]?.props.width && one.props.height === 38)).toBe(true)
  expect(String(lanes.find(one => String(one.props.alt).startsWith('Lint'))?.props.alt)).toBe("Lint the new files's lane: 1 tool call, 1 failed, failed")
  expect(String(lanes[0]?.props.source)).toContain('>Agent<')
  const axis = svgs.find(one => String(one.props.alt).startsWith('Time'))
  expect(axis?.props).toMatchObject({ width: lanes[0]?.props.width, height: 18 })
  expect(String(axis?.props.source)).toContain('>now<')
  // the shells under the loop that started them, titled by what they are for
  const text = (await ui.find({ key: 'org:timeline:lanes' }))!.text
  expect(text.indexOf('builder')).toBeLessThan(text.indexOf('Start the dev server'))
  expect(text.indexOf('Start the dev server')).toBeLessThan(text.indexOf('tester'))
  expect(text.indexOf('Orchestrator')).toBeLessThan(text.indexOf('CI checks on PR 42'))
  expect(text.indexOf('CI checks on PR 42')).toBeLessThan(text.indexOf('researcher'))
  expect(svgs.some(one => one.props.alt === 'Shell · npm run dev: Start the dev server, running')).toBe(true)
  // a legend of only what it holds; the messages under it, each numbered as its arrow is
  expect(svgs.find(one => String(one.props.alt).startsWith('Legend'))?.props.alt).toBe('Legend: a tool call (named where it fits), thinking, failed, waiting on you, done, stopped, idle, a message, you wrote, in the background')
  expect((await ui.find({ key: 'tl:msg:1' }))?.text).toMatch(/^1\d\d:\d\dbuilder→reviewer“Limiter ready for review”$/)
  expect((await ui.find({ key: 'tl:msg:2' }))?.text).toMatch(/^2\d\d:\d\dreviewer→builder“Two questions on the window”$/)
  expect(String(lanes.find(one => String(one.props.alt).startsWith('builder'))?.props.source)).toContain('>1</text>')
  // each name opens its page
  await press(ui, W.agentKeyOf(IDS.reviewer))
  expect((await ui.find({ key: 'page:head' }))?.text).toContain('reviewer')
  await press(ui, 'key:b')
  // the pick stays: back on the Dashboard and on Org again, the Timeline
  await press(ui, 'tab:now')
  await press(ui, 'tab:org')
  expect(await ui.find({ key: `tl:${IDS.reviewer}` })).toBeDefined()
  await press(ui, 'org:show:chart')
  expect(await ui.find({ key: 'org:chart' })).toBeDefined()
  await ui.unmount()
})

test('the desktop`s Timeline folds the hours nobody worked: the break says how long, the work gets the width; a finished shell ends where it ended', async ($, on) => {
  await demo($, on, longTimeline())
  const ui = (await $.ui.mount(pane('desktop'))) as unknown as Drawing
  await press(ui, 'tab:org')
  await press(ui, 'org:show:timeline')
  expect((await ui.find({ key: 'org:timeline:summary' }))?.text).toBe('3h 51m · 3 agents · 2 in the background · 2 messages⋯ 2h 50m idle, folded')
  const svgs = await ui.findAll({ type: 'Svg' })
  const axis = svgs.find(one => String(one.props.alt).startsWith('Time'))!
  expect(String(axis.props.alt)).toContain('2h 50m idle folded')
  expect(String(axis.props.source)).toContain('>⋯ 2h 50m<')
  // the Orchestrator lived across the break (hatched); builder's lane is done, its shell's bar ends before now with its cap
  const main = svgs.find(one => String(one.props.alt).startsWith("Orchestrator's lane"))!
  expect(String(main.props.source)).toMatch(/l4 -10M/)
  const shell = svgs.find(one => String(one.props.alt).startsWith('Shell · node web/dev.js'))!
  expect(shell.props.alt).toBe('Shell · node web/dev.js: Start the web dev server, ended')
  expect(String(shell.props.source)).toContain(`fill="#a8aeb2"`)
  const builder = (await ui.find({ key: `tl:${IDS.builder}` }))!
  expect(builder.text).toMatch(/^builderdoneDone/)
  const lanes = (await ui.find({ key: 'org:timeline:lanes' }))!.text
  expect(lanes.indexOf('builder')).toBeLessThan(lanes.indexOf('Start the web dev server'))
  await ui.unmount()
})

test('the desktop`s Timeline of a run too large keeps under the Desktop`s bounds: the Orchestrator and the newest 19, then "and n more"; the newest 12 messages; under 2000 elements and its characters', async ($, on) => {
  await demo($, on, bigTimeline(80, 400))
  const ui = (await $.ui.mount(pane('desktop'))) as unknown as Drawing
  await press(ui, 'tab:org')
  await press(ui, 'org:show:timeline')
  const drawn = await ui.drawn()
  expect(countOf(drawn)).toBeLessThan(2000)
  expect(JSON.stringify(drawn).length).toBeLessThan(262_144)
  const names = (await ui.findAll({ type: 'Button' })).filter(one => (one.key ?? '').startsWith('agent:')).map(one => one.props.label)
  expect(names).toHaveLength(MOST_LANES)
  expect(names.slice(0, 2)).toEqual(['Orchestrator', 'agent number 61 with a long name'])
  expect(JSON.stringify(drawn)).toContain('and 60 more agents, started earlier: /apiarius web shows them all.')
  // 19 messages between the lanes drawn, numbered; the newest 12 listed
  expect(await ui.find({ key: 'tl:msg:7' })).toBeUndefined()
  for (const n of [8, 19]) expect(await ui.find({ key: `tl:msg:${n}` })).toBeDefined()
  expect(JSON.stringify(drawn)).toContain('and 7 earlier messages: Chat holds them all.')
  await ui.unmount()
})

test('the terminal`s Timeline: the same rows in cells fitted to its columns, each name a Button to its page, what it does on the line under it; calls on their colour, ─ thinking, ┄ idle, ✓ done, ✕ failed, ■ stopped, ◆ your prompt, ↓↑ messages; the shells under their starters; the messages listed', async ($, on) => {
  await demo($, on)
  for (const columns of [84, 60]) {
    const ui = (await $.ui.mount(pane('terminal', columns))) as unknown as Drawing
    await press(ui, 'tab:org')
    await press(ui, 'org:show:timeline')
    expect(await ui.findAll({ type: 'Svg' })).toEqual([])
    const lanes = (await ui.find({ key: 'org:timeline:lanes' }))!
    const axis = (await ui.find({ key: 'tl:axis' }))!
    expect(axis.text.endsWith('now')).toBe(true)
    expect(Array.from(axis.text).length).toBeLessThanOrEqual(columns)
    for (const id of ['main', IDS.researcher, IDS.builder, IDS.tester, IDS.linter, IDS.docs, IDS.scout, IDS.reviewer]) {
      const row = (await ui.find({ key: `tl:${id}` }))!
      // the row's words, then its cells: never past the pane's columns
      expect(Array.from(row.text).length).toBeLessThanOrEqual(columns)
      expect((await ui.find({ key: W.agentKeyOf(id) }))?.props.plain).toBe(true)
    }
    expect((await ui.find({ key: `tl:now:${IDS.docs}` }))?.text).toMatch(/^Done \d+m ago: “Documented the limits/)
    for (const glyph of ['─', '┄', '✓', '✕', '■', '◆', '↓', '↑', '━']) expect(lanes.text).toContain(glyph)
    const grounds = new Set((await ui.findAll({ type: 'Text' })).map(one => one.props.backgroundColor).filter(Boolean))
    for (const ground of ['#1d4ed8', '#991b1b', '#b45309']) expect(grounds.has(ground)).toBe(true)
    // the shells under the loop that started them
    const shell = (await ui.find({ key: 'tl:bg:bash_7' }))!
    expect(shell.text.startsWith('   └ Start the dev')).toBe(true)
    expect(shell.text.endsWith('━')).toBe(true)
    expect(lanes.text.indexOf('builder')).toBeLessThan(lanes.text.indexOf('└ Start the dev'))
    expect(lanes.text.indexOf('└ Start the dev')).toBeLessThan(lanes.text.indexOf('tester'))
    expect((await ui.find({ key: 'tl:legend' }))?.text).toContain('Read a tool call')
    const messages = (await ui.find({ key: 'tl:messages' }))!.text
    expect(messages).toContain('builder → reviewer')
    expect(messages).toContain('“Limiter ready for review”')
    await press(ui, W.agentKeyOf(IDS.tester))
    expect((await ui.find({ key: 'page:head' }))?.text).toContain('tester')
    await press(ui, 'key:b')
    await ui.unmount()
  }
})

test('the terminal`s Timeline folds the hours nobody worked: ╱╱╱ on the axis and across the lanes that lived through them, the summary saying how long', async ($, on) => {
  await demo($, on, longTimeline())
  const ui = (await $.ui.mount(pane('terminal', 84))) as unknown as Drawing
  await press(ui, 'tab:org')
  await press(ui, 'org:show:timeline')
  expect((await ui.find({ key: 'org:timeline:summary' }))?.text).toBe('3h 51m · 3 agents · 2 in the background · 2 messages╱╱╱ 2h 50m idle, folded')
  expect((await ui.find({ key: 'tl:axis' }))?.text).toContain('╱╱╱')
  expect((await ui.find({ key: 'tl:main' }))?.text).toContain('╱')
  expect((await ui.find({ key: `tl:${IDS.builder}` }))?.text).not.toContain('╱')
  expect((await ui.find({ key: 'tl:bg:bash_9' }))?.text).toMatch(/━■ *$/)
  await ui.unmount()
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
