/**
 * Background and Stop (hooks/background.ts, ./ui/v2/background and ./stop):
 * what runs when no agent is talking, from the calls that start it and
 * Claude Code's own snapshots, gone when its stop is seen; the Background
 * section, folded to one line; Stop turn, and Stop and Cancel only where
 * Claude Code's own permission check allows them, every stop through
 * Claude Code's own channels (TaskStop, CronDelete, `$.turn.abort`), and
 * Chat saying what you stopped.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as B from '../hooks/background'
import * as M from '../hooks/model'
import * as W from '../hooks/web'
import { bash } from './tools'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { command, deck, lastState, newWorld, NOW, work, world, type World } from './world'

/** A call as the hooks module hands it to the record. */
function call(toolUseId: string, tool: string, input: Record<string, unknown>, by = M.MAIN, at = NOW): B.Call {
  return { toolUseId, tool, input, by, at }
}

/** The v2 state the last state.json written holds. */
function v2Of(w: World): W.WebStateV2 {
  return (lastState(w) as W.WebState & { v2: W.WebStateV2 }).v2
}

test('a call that starts background work shows at once, by the loop that called it, and takes Claude Code`s id when it ends; one that never started, or ran in the foreground after all, goes; one Claude Code moved to the background shows then', () => {
  const data = M.emptyData(NOW)
  // a shell in the background: its row at once, keyed by its call
  expect(B.noteStart(data, call('t1', 'Bash', { command: 'npm run dev', description: 'Start the dev server', run_in_background: true }, 'agent-b'))).toBe(true)
  expect(B.rowsOf(data)).toMatchObject([{ id: 't1', isBound: false, kind: 'shell', title: 'npm run dev', note: 'Start the dev server', by: 'agent-b', call: 't1', at: NOW }])
  // a shell in the foreground, and any other call, start nothing
  expect([B.noteStart(data, call('t2', 'Bash', { command: 'npm test' })), B.noteStart(data, call('t9', 'Read', { file_path: 'a' }))]).toEqual([false, false])
  B.noteEnd(data, { ...call('t1', 'Bash', { command: 'npm run dev', run_in_background: true }, 'agent-b'), ok: true, result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bash_1' } })
  expect(B.rowsOf(data)).toMatchObject([{ id: 'bash_1', isBound: true, by: 'agent-b' }])
  // Claude Code moved a foreground shell to the background (Ctrl+B): its row now
  B.noteEnd(data, { ...call('t2', 'Bash', { command: 'npm test', description: 'Run the tests' }), ok: true, result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bash_2', backgroundedByUser: true } })
  expect(B.rowsOf(data).map(row => [row.id, row.title, row.by])).toEqual([['bash_1', 'npm run dev', 'agent-b'], ['bash_2', 'npm test', 'main']])
  // a background call that was refused, or that ended with no task: no row
  B.noteStart(data, call('t3', 'Monitor', { description: 'Tail the log', command: 'tail -f log', timeout_ms: 1000 }))
  B.noteEnd(data, { ...call('t3', 'Monitor', {}), ok: false, result: null })
  B.noteStart(data, call('t4', 'Bash', { command: 'sleep 1', run_in_background: true }))
  B.noteEnd(data, { ...call('t4', 'Bash', {}), ok: true, result: { stdout: '', stderr: '', interrupted: false } })
  expect(B.rowsOf(data).map(row => row.id)).toEqual(['bash_1', 'bash_2'])

  // a monitor, a workflow, a cron and a wakeup, each with what Claude Code said of it
  B.noteStart(data, call('t5', 'Monitor', { description: 'CI checks on PR 42', command: 'gh pr checks 42 --watch', timeout_ms: 1000 }))
  B.noteEnd(data, { ...call('t5', 'Monitor', {}), ok: true, result: { taskId: 'mon_1', timeoutMs: 1000 } })
  B.noteStart(data, call('t6', 'Workflow', { script: 'export const meta = { name: "release-check", description: "", phases: [] }' }))
  B.noteEnd(data, { ...call('t6', 'Workflow', {}), ok: true, result: { status: 'async_launched', taskId: 'wf_1', workflowName: 'release-check' } })
  B.noteStart(data, call('t7', 'CronCreate', { cron: '0 9 * * 1-5', prompt: "Summarise yesterday's PRs", recurring: true }))
  B.noteEnd(data, { ...call('t7', 'CronCreate', {}), ok: true, result: { id: 'cron_1', humanSchedule: 'Every weekday at 9:00', recurring: true, nextFireAt: NOW + 3_600_000 } })
  B.noteStart(data, call('t8', 'ScheduleWakeup', { delaySeconds: 600, reason: 'Check the deploy', prompt: '/loop check the deploy' }))
  B.noteEnd(data, { ...call('t8', 'ScheduleWakeup', {}), ok: true, result: { scheduledFor: NOW + 600_000, clampedDelaySeconds: 600, wasClamped: false } })
  expect(B.rowsOf(data).slice(2)).toMatchObject([
    { id: 'mon_1', isBound: true, kind: 'monitor', title: 'CI checks on PR 42' },
    { id: 'wf_1', isBound: true, kind: 'workflow', title: 'release-check' },
    { id: 'cron_1', isBound: true, kind: 'cron', title: "Summarise yesterday's PRs", note: 'Every weekday at 9:00', schedule: '0 9 * * 1-5', recurring: true, nextAt: NOW + 3_600_000 },
    // a wakeup's id comes with Claude Code's next snapshot
    { id: 't8', isBound: false, kind: 'wakeup', title: 'Check the deploy', prompt: '/loop check the deploy', recurring: false, nextAt: NOW + 600_000 },
  ])
})

test('a row goes when its stop is seen: TaskStop or CronDelete of it, ScheduleWakeup`s stop for the wakeups, a task notification that it ended, a one-shot schedule firing; a recurring one`s next run is then unknown', () => {
  const data = M.emptyData(NOW)
  const started = (id: string, tool: string, input: Record<string, unknown>, result: Record<string, unknown>) => {
    B.noteStart(data, call(id, tool, input))
    B.noteEnd(data, { ...call(id, tool, input), ok: true, result })
  }
  started('t1', 'Bash', { command: 'a', run_in_background: true }, { backgroundTaskId: 'bash_1' })
  started('t2', 'Bash', { command: 'b', run_in_background: true }, { backgroundTaskId: 'bash_2' })
  started('t3', 'Bash', { command: 'c', run_in_background: true }, { backgroundTaskId: 'bash_3' })
  started('t4', 'CronCreate', { cron: '0 9 * * *', prompt: 'daily' }, { id: 'cron_1', humanSchedule: 'Every day', recurring: true, nextFireAt: NOW + 1000 })
  started('t5', 'CronCreate', { cron: '30 14 28 2 *', prompt: 'once', recurring: false }, { id: 'cron_2', humanSchedule: 'Once', recurring: false, nextFireAt: NOW + 2000 })
  started('t6', 'ScheduleWakeup', { delaySeconds: 60, reason: 'Look again', prompt: '/loop look' }, { scheduledFor: NOW + 60_000 })
  // a refused TaskStop stops nothing
  expect(B.noteEnd(data, { ...call('s0', 'TaskStop', { task_id: 'bash_1' }), ok: false, result: null })).toBe(false)
  expect(B.noteEnd(data, { ...call('s1', 'TaskStop', { task_id: 'bash_1' }), ok: true, result: { message: 'stopped', task_id: 'bash_1', task_type: 'shell' } })).toBe(true)
  expect(B.noteTaskEnds(data, '<task-notification><task-id>bash_2</task-id><status>completed</status><summary>Done</summary></task-notification>')).toBe(true)
  // a notification that is no end leaves it
  expect(B.noteTaskEnds(data, '<task-notification><task-id>bash_3</task-id><status>running</status></task-notification>')).toBe(false)
  expect(B.noteFired(data, 'daily')).toBe(true)
  expect(B.rowsOf(data).find(row => row.id === 'cron_1')?.nextAt).toBeUndefined()
  expect(B.noteFired(data, 'once')).toBe(true)
  expect(B.noteEnd(data, { ...call('s2', 'ScheduleWakeup', { stop: true }), ok: true, result: { scheduledFor: 0, clampedDelaySeconds: 0, wasClamped: false, stopped: true } })).toBe(true)
  expect(B.rowsOf(data).map(row => row.id)).toEqual(['bash_3', 'cron_1'])
  expect(B.noteEnd(data, { ...call('s3', 'CronDelete', { id: 'cron_1' }), ok: true, result: { id: 'cron_1' } })).toBe(true)
  expect(B.rowsOf(data).map(row => row.id)).toEqual(['bash_3'])
})

test('Claude Code`s snapshot (Stop, SubagentStop) adds what the deck did not see start, with no starter; drops what it no longer lists and was seen before it; names a wakeup by its prompt; leaves a background agent to the tree, and a list it leaves out alone', () => {
  const data = M.emptyData(NOW)
  B.noteStart(data, call('t1', 'Bash', { command: 'npm run dev', run_in_background: true }, 'agent-b', NOW - 60_000))
  B.noteEnd(data, { ...call('t1', 'Bash', {}, 'agent-b', NOW - 60_000), ok: true, result: { backgroundTaskId: 'bash_1' } })
  B.noteStart(data, call('t2', 'Bash', { command: 'old', run_in_background: true }, M.MAIN, NOW - 60_000))
  B.noteEnd(data, { ...call('t2', 'Bash', {}, M.MAIN, NOW - 60_000), ok: true, result: { backgroundTaskId: 'bash_2' } })
  B.noteStart(data, call('t3', 'ScheduleWakeup', { delaySeconds: 600, reason: 'Check the deploy', prompt: '/loop check the deploy' }, M.MAIN, NOW - 60_000))
  B.noteEnd(data, { ...call('t3', 'ScheduleWakeup', {}, M.MAIN, NOW - 60_000), ok: true, result: { scheduledFor: NOW + 540_000 } })
  // a call that started the moment the snapshot was taken stays
  B.noteStart(data, call('t4', 'Bash', { command: 'just now', run_in_background: true }, M.MAIN, NOW))
  B.noteEnd(data, { ...call('t4', 'Bash', {}, M.MAIN, NOW), ok: true, result: { backgroundTaskId: 'bash_4' } })
  const isChanged = B.noteSnapshot(data, {
    tasks: [
      { id: 'bash_1', type: 'shell', status: 'running', description: 'Start the dev server', command: 'npm run dev' },
      { id: 'bash_9', type: 'shell', status: 'pending', description: 'Watch the tests', command: 'npx vitest --watch' },
      { id: 'agent-b', type: 'subagent', status: 'running', description: 'Build it', agent_type: 'general-purpose' },
      { id: 'agent-z', type: 'subagent', status: 'running', description: 'Lost in a reload', agent_type: 'Explore' },
    ],
    crons: [{ id: 'cron_9', schedule: '54 21 14 10 *', recurring: false, prompt: '/loop check the deploy' }],
    at: NOW,
    agents: new Set(['main', 'agent-b']),
  })
  expect(isChanged).toBe(true)
  expect(B.rowsOf(data).map(row => [row.id, row.kind, row.status, row.by])).toEqual([
    ['bash_1', 'shell', 'running', 'agent-b'],
    ['cron_9', 'wakeup', '', 'main'],
    ['bash_4', 'shell', '', 'main'],
    ['bash_9', 'shell', 'pending', ''],
    ['agent-z', 'agent', 'running', ''],
  ])
  expect(B.rowsOf(data).find(row => row.id === 'cron_9')).toMatchObject({ isBound: true, title: 'Check the deploy', nextAt: NOW + 540_000, schedule: '54 21 14 10 *' })
  // an engine that sends no lists changes nothing; one that lists nothing empties what was seen before it
  expect(B.noteSnapshot(data, { at: NOW + 10_000, agents: new Set() })).toBe(false)
  B.noteSnapshot(data, { tasks: [], crons: [], at: NOW + 10_000, agents: new Set() })
  expect(B.rowsOf(data)).toEqual([])
})

test('v2`s background: tasks oldest first, then schedules soonest first, each its kind and Claude Code`s words, its starter`s name, its age or next run (none for one first seen in a snapshot), and the line of counts; none, no rows', () => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  expect(state.background.rows.map(row => [row.id, row.kind, row.what, row.title, row.status, row.byName, row.when])).toEqual([
    ['bash_7', 'shell', 'Shell · Start the dev server', 'npm run dev', 'running', 'builder', '18m'],
    ['mon_2', 'monitor', 'Monitor', 'CI checks on PR 42', 'running', 'Orchestrator', '3m'],
    ['bash_3', 'shell', 'Shell · Watch the limiter tests', 'npx vitest --watch', 'running', '', ''],
    ['wake_9c2', 'wakeup', 'Wakeup', 'Check the deploy finished', 'scheduled', 'Orchestrator', 'in 18m'],
    ['cron_4e1', 'cron', 'Cron · Every weekday at 9:00', "Summarise yesterday's PRs", 'scheduled', 'Orchestrator', 'in 11h'],
  ])
  expect(state.background.rows.find(row => row.id === 'bash_3')?.by).toBeNull()
  expect([state.background.tasks, state.background.scheduled, state.background.text]).toEqual([3, 2, '2 shells · 1 monitor · 2 scheduled'])
  // a one-shot schedule a minute past its time has fired: no longer shown
  const later = W.deckStateOf(session.data, session.git, session.usage, SAMPLE_NOW + 21 * 60_000, session.sessionId, session.cwd)
  expect(later.background.rows.map(row => row.id)).not.toContain('wake_9c2')
  // nothing in the background: no rows, no line
  expect(B.backgroundOf(M.emptyData(NOW), [], NOW)).toEqual(B.NO_BACKGROUND)
})

test('Stop and Cancel show only where Claude Code`s own permission check allows the call (allow), and say why where it does not (ask, deny, not asked yet); a foreground agent and the Orchestrator say why; a finished agent says nothing', () => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const row = (id: string) => state.agents.find((one): one is W.V2AgentRow => one.row === 'agent' && one.id === id)!
  expect(row(IDS.builder).stop).toEqual({ tool: 'TaskStop', label: 'Stop', can: true, why: '' })
  expect(row(IDS.reviewer).stop).toMatchObject({ can: true })
  expect(row(M.MAIN).stop).toEqual({ tool: 'TaskStop', label: 'Stop', can: false, why: 'The Orchestrator stops with its turn: Stop turn ends it' })
  expect([row(IDS.researcher).stop, row(IDS.scout).stop]).toEqual([undefined, undefined])
  const bg = (id: string) => state.background.rows.find(one => one.id === id)!
  expect([bg('bash_7').stop, bg('cron_4e1').stop]).toEqual([
    { tool: 'TaskStop', label: 'Stop', can: true, why: '' },
    { tool: 'CronDelete', label: 'Cancel', can: true, why: '' },
  ])
  expect(bg('bash_3').stop).toEqual({ tool: 'TaskStop', label: 'Stop', can: false, why: 'Claude Code asks you before TaskStop here: stop it in Claude Code' })

  const data = M.emptyData(NOW)
  expect(B.stopOf(data, 'TaskStop', 'x')).toEqual({ tool: 'TaskStop', label: 'Stop', can: false, why: 'Not asked yet whether Claude Code allows TaskStop here' })
  M.noteSpawn(data, { toolUseId: 'toolu_a', agentId: 'agent-a', parentId: M.MAIN, description: 'In the background', prompt: 'p', type: 'Explore', isTeammate: false, background: true, model: 'claude-haiku', at: NOW })
  M.noteSpawn(data, { toolUseId: 'toolu_f', agentId: 'agent-f', parentId: M.MAIN, description: 'In the foreground', prompt: 'p', type: 'Explore', isTeammate: false, background: false, model: 'claude-haiku', at: NOW })
  // what the deck asks Claude Code about: TaskStop of the background agent alone, until its verdict is old
  expect(B.staleCallsOf(data, NOW).map(one => [one.tool, one.input])).toEqual([['TaskStop', { task_id: 'agent-a' }]])
  B.noteVerdict(data, B.verdictKeyOf('TaskStop', 'agent-a'), { decision: 'deny', reason: 'Denied by a rule' }, NOW)
  expect(B.staleCallsOf(data, NOW + 1000)).toEqual([])
  expect(B.staleCallsOf(data, NOW + B.VERDICT_MS + 1)).toHaveLength(1)
  const rows = B.withStops(W.agentRowsOf(data, NOW), data)
  const of = (id: string) => rows.find((one): one is W.V2AgentRow => one.row === 'agent' && one.id === id)?.stop
  expect(of('agent-a')).toEqual({ tool: 'TaskStop', label: 'Stop', can: false, why: "Claude Code's permissions deny TaskStop here: Denied by a rule" })
  expect(of('agent-f')).toEqual({ tool: 'TaskStop', label: 'Stop', can: false, why: "Claude Code's TaskStop takes no foreground agent: it ends with its caller's turn" })
  // between turns the Orchestrator says nothing
  expect(of(M.MAIN)).toBeUndefined()
  // a verdict on a call the deck can no longer make goes
  M.agentOf(data, 'agent-a')!.status = 'completed'
  B.noteVerdict(data, 'TaskStop:gone', { decision: 'allow' }, NOW)
  expect(data.verdicts).toEqual({})
})

test('the page`s stopBackground names a row by its id in `background`; one Claude Code gave no id yet, or none, is refused and says why; a restored record keeps only its own shape', () => {
  const session = v2Session()
  expect(W.routeOf({ cmd: 'stopBackground', id: 'b1', bgId: 'bash_7' }, session.data)).toEqual({ kind: 'stopBackground', bgId: 'bash_7' })
  expect(W.routeOf({ cmd: 'stopBackground', bgId: 'nope' }, session.data)).toBeNull()
  expect(W.refusalOf({ cmd: 'stopBackground', bgId: 'nope' }, session.data)).toBe('Nothing runs in the background by that name: it may have ended')
  const data = M.emptyData(NOW)
  B.noteStart(data, call('t1', 'ScheduleWakeup', { delaySeconds: 60, reason: 'r', prompt: 'p' }))
  expect(W.routeOf({ cmd: 'stopBackground', bgId: 't1' }, data)).toBeNull()

  const restored = { ...M.emptyData(NOW), background: [{ id: 'bash_1', isBound: true, kind: 'shell', at: NOW, title: 'npm run dev' }, { id: '', kind: 'shell', at: NOW }, { id: 'x', kind: 'nonsense', at: NOW }, 'junk'], verdicts: { 'TaskStop:bash_1': { decision: 'allow', at: NOW }, bad: { decision: 'maybe', at: NOW } } } as unknown as Parameters<typeof B.heal>[0]
  B.heal(restored)
  expect(restored.background).toEqual([{ id: 'bash_1', isBound: true, kind: 'shell', type: '', status: '', title: 'npm run dev', note: '', prompt: '', schedule: '', recurring: false, by: '', call: '', at: NOW, seenAt: 0 }])
  expect(restored.verdicts).toEqual({ 'TaskStop:bash_1': { decision: 'allow', at: NOW } })
})

/** The world (./world: Claude Code's permission checks and `$.turn.abort` noted), TaskStop and CronDelete held until the test settles them, Bash too where asked. */
function stopWorld(on: On, holding: string[] = ['TaskStop', 'CronDelete']) {
  const w = newWorld({ holding })
  world(on, w)
  return { w, checks: w.checks, aborted: w.aborted }
}

/** The held call of `tool` the test has not settled yet. */
function heldOf(w: World, tool: string) {
  const held = w.held.find(one => one.tool === tool)
  if (!held) throw new Error(`no ${tool} call is held`)
  w.held.splice(w.held.indexOf(held), 1)
  return held
}

test('through the hooks: a shell in the background shows the moment its call starts, by its caller, and takes its id; Claude Code`s Stop snapshot adds what the deck did not see start; a task notification that it ended takes it down', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { w } = stopWorld(on, ['Bash'])
  // Claude Code's check lets the agents' calls run
  w.verdict = 'allow'
  await work($)
  const running = $.tool.call(bash({ command: 'npm run dev', description: 'Start the dev server', run_in_background: true, tool_use_id: 'toolu_dev', agentId: 'agent-x1' }))
  await clock.advance(400)
  expect(v2Of(w).background.rows).toMatchObject([{ id: 'toolu_dev', kind: 'shell', title: 'npm run dev', by: 'agent-x1', byName: 'scout', status: 'running', stop: null }])
  heldOf(w, 'Bash').settle({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bash_7' } as never })
  await running
  await clock.advance(400)
  expect(v2Of(w).background.rows.map(row => row.id)).toEqual(['bash_7'])
  // Claude Code's snapshot as Claude stops, two minutes on: it lists a watcher the deck never saw start
  await clock.advance(120_000)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'bash_7', type: 'shell', status: 'running', description: 'Start the dev server', command: 'npm run dev' }, { id: 'bash_3', type: 'shell', status: 'running', description: 'Watch the tests', command: 'npx vitest --watch' }], session_crons: [] })
  await clock.advance(400)
  expect(v2Of(w).background.rows.map(row => [row.id, row.by, row.when])).toEqual([['bash_7', 'agent-x1', '2m'], ['bash_3', null, '']])
  expect(v2Of(w).background.text).toBe('2 shells')
  // the dev server's notification that it ended
  await $.prompt.submit({ text: '<task-notification><task-id>bash_7</task-id><status>killed</status><summary>Dev server stopped</summary></task-notification>', origin: { kind: 'task-notification' }, wait: false })
  await clock.advance(400)
  expect(v2Of(w).background.rows.map(row => row.id)).toEqual(['bash_3'])
})

test('Stop: Claude Code`s permission check asked first (no permission asked of you or granted); TaskStop of a background agent only on allow, its row stopped, Chat says "You stopped scout"; Stop and Cancel in the background by TaskStop and CronDelete; Stop turn by $.turn.abort', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { w, checks, aborted } = stopWorld(on)
  await work($)
  await clock.advance(400)
  // asked at once about TaskStop of scout: the check alone, nothing run
  expect(checks).toContainEqual({ tool: 'TaskStop', input: { task_id: 'agent-x1' } })
  expect(v2Of(w).agents.find(row => row.row === 'agent' && row.id === 'agent-x1')).toMatchObject({ stop: { can: false, why: 'Claude Code asks you before TaskStop here: stop it in Claude Code' } })
  const child = w.children[0]
  command(child, { cmd: 'stopAgent', id: 's-1', agentId: 'agent-x1' })
  await clock.advance(400)
  expect(w.held).toEqual([])
  expect(lastState(w).acks.find(ack => ack.id === 's-1')).toMatchObject({ status: 'failed', text: 'Claude Code asks you before TaskStop here: stop it in Claude Code' })

  // allowed: TaskStop runs, through Claude Code's own tool, with no consent of the deck's
  w.verdict = 'allow'
  command(child, { cmd: 'stopAgent', id: 's-2', agentId: 'agent-x1' })
  await clock.advance(100)
  const stop = heldOf(w, 'TaskStop')
  expect(stop.e).toMatchObject({ tool: 'TaskStop', task_id: 'agent-x1' })
  expect(stop.e.consent).toBeUndefined()
  stop.settle({ result: { message: 'Stopped', task_id: 'agent-x1', task_type: 'local_agent' } as never })
  await clock.advance(400)
  let v2 = v2Of(w)
  expect(lastState(w).acks.find(ack => ack.id === 's-2')).toMatchObject({ status: 'delivered', text: 'Stopped scout' })
  expect(v2.agents.find(row => row.row === 'agent' && row.id === 'agent-x1')).toMatchObject({ isStopped: true, status: 'failed' })
  expect(v2.chat.filter(row => row.kind === 'stop').map(row => [row.from, row.to, row.text, row.ackId])).toEqual([['you', 'agent-x1', 'You stopped scout', 's-2']])

  // a shell and a cron the Orchestrator started: Stop is TaskStop, Cancel is CronDelete
  await $.tool.call(bash({ command: 'npm run dev', run_in_background: true, tool_use_id: 'toolu_dev' }))
  await $.tool.call({ tool: 'CronCreate', cron: '0 9 * * 1-5', prompt: 'Summarise the PRs', tool_use_id: 'toolu_cron' } as never)
  // the world answers a call with 'ok': Claude Code's ids come with its snapshot instead
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'bash_7', type: 'shell', status: 'running', description: '', command: 'npm run dev' }], session_crons: [{ id: 'cron_1', schedule: '0 9 * * 1-5', recurring: true, prompt: 'Summarise the PRs' }] })
  await clock.advance(400)
  v2 = v2Of(w)
  expect(v2.background.rows.map(row => [row.id, row.stop?.label, row.stop?.can])).toEqual([['bash_7', 'Stop', true], ['cron_1', 'Cancel', true]])
  command(child, { cmd: 'stopBackground', id: 'b-1', bgId: 'bash_7' })
  await clock.advance(100)
  heldOf(w, 'TaskStop').settle({ result: { message: 'Stopped', task_id: 'bash_7', task_type: 'local_bash' } as never })
  command(child, { cmd: 'stopBackground', id: 'b-2', bgId: 'cron_1' })
  await clock.advance(100)
  const cancel = heldOf(w, 'CronDelete')
  expect(cancel.e).toMatchObject({ tool: 'CronDelete', id: 'cron_1' })
  cancel.settle({ result: { id: 'cron_1' } as never })
  await clock.advance(400)
  v2 = v2Of(w)
  expect(v2.background.rows).toEqual([])
  expect(v2.chat.filter(row => row.kind === 'stop').map(row => row.text)).toEqual(['You stopped scout', 'You stopped npm run dev', 'You cancelled Summarise the PRs'])

  // Stop turn: $.turn.abort of the main loop's running turn, as Esc does
  command(child, { cmd: 'abortTurn', id: 't-1', turnId: 't1' })
  await clock.advance(400)
  expect(aborted).toEqual(['t1'])
  expect(lastState(w).acks.find(ack => ack.id === 't-1')).toMatchObject({ status: 'delivered', text: 'Stopped the turn' })
  expect(v2Of(w).chat.filter(row => row.kind === 'stop').pop()).toMatchObject({ from: 'you', to: 'main', text: 'You stopped the turn' })
})

const SURFACES = ['terminal', 'desktop'] as const

function pane(surface: 'terminal' | 'desktop', bodyColumns = 84) {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId: 'agent-deck',
    viewport: { columns: bodyColumns + 4, rows: 400, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} },
  }
}

/** `/deck demo` over the v2 sample as the engine builds it, `change` laid over it. */
async function demo($: Engine, on: On, change: (state: W.WebStateV2) => W.WebStateV2 = state => state) {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const session = v2Session()
  const state = change(W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable))
  const agentFiles = new Map(W.agentFilesOf(session.data).map(one => [one.id, one.text]))
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(state) }
    const agent = /\/web\/fixtures\/v2\/agents\/([^/]+)\.json$/.exec(path)?.[1]
    if (agent && agentFiles.has(agent)) return { value: agentFiles.get(agent)! }
    return { deny: 'no such file' }
  })
  on('ui.focus', () => ({}))
  const w = newWorld()
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  return { w, state }
}

async function keysOf(ui: { findAll: (q: { type: 'Button' }) => Promise<{ key?: string }[]> }, prefix: string): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith(prefix))
}

test('the pane: Background under the agents, a row each (its kind, title, what it is, who started it, its status, its age or next run), Stop and Cancel only where allowed; folded, one line of counts; none, no section', async ($, on) => {
  const { w } = await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // under the agents, before the figures
    const heads = await keysOf(ui, 'fold:dash:')
    expect(heads.slice(0, 3)).toEqual(['fold:dash:agents', 'fold:dash:background', 'fold:dash:figures'])
    expect((await ui.find({ key: 'fold:dash:background' }))?.props.label).toBe('▾ BACKGROUND 5')
    const section = (await ui.find({ key: 'now:background' }))?.text ?? ''
    expect(section).toContain('2 shells · 1 monitor · 2 scheduled')
    const dev = (await ui.find({ key: 'bg:bash_7' }))?.text ?? ''
    for (const word of ['npm run dev', 'Shell · Start the dev server', 'started by', 'builder', '◐ running', '18m']) expect(dev).toContain(word)
    expect((await ui.find({ key: 'bg:cron_4e1' }))?.text).toContain('Cron · Every weekday')
    expect((await ui.find({ key: 'bg:cron_4e1' }))?.text).toContain('in 11h')
    // Stop and Cancel where Claude Code allows them; none on the watcher it would ask you about
    expect(await keysOf(ui, 'bg:stop:')).toEqual(['bg:stop:bash_7', 'bg:stop:mon_2', 'bg:stop:wake_9c2', 'bg:stop:cron_4e1'])
    expect((await ui.find({ key: 'bg:stop:cron_4e1' }))?.props).toMatchObject({ label: 'Cancel', plain: true })
    expect((await ui.find({ key: 'bg:bash_3' }))?.text).not.toContain('started by')
    // the sample stops nothing
    await ui.press({ key: 'bg:stop:bash_7' })
    expect(w.toasts[w.toasts.length - 1]).toBe('Sample data: nothing is stopped. Back to this chat to stop your background work.')
    // folded: its head and its line of counts
    await ui.press({ key: 'fold:dash:background' })
    await ui.redraw()
    expect((await ui.find({ key: 'fold:dash:background' }))?.props.label).toBe('▸ BACKGROUND 5')
    expect((await ui.find({ key: 'now:background' }))?.text).toContain('· 2 shells · 1 monitor · 2 scheduled')
    expect(await ui.find({ key: 'bg:bash_7' })).toBeUndefined()
    await ui.press({ key: 'fold:dash:background' })
    await ui.unmount()
  }
})

test('nothing in the background: no Background section, and the band counts none', async ($, on) => {
  await demo($, on, state => ({ ...state, background: B.NO_BACKGROUND }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ key: 'now:background' })).toBeUndefined()
    expect(await keysOf(ui, 'fold:dash:background')).toEqual([])
    await ui.unmount()
  }
  expect(W.bandOf({ agents: [], needs: [], background: B.NO_BACKGROUND })).toBeNull()
})

test('the pane: Stop turn at the right of the header while the main loop`s turn runs; Stop beside Open on a background agent`s or a teammate`s card, none on the Orchestrator`s; on its page Stop, or why none', async ($, on) => {
  const { w } = await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'stop:turn' }))?.props).toMatchObject({ label: 'Stop turn', plain: true })
    expect((await ui.find({ key: 'deck:header' }))?.text).toContain('Stop turn')
    expect(await keysOf(ui, 'card:stop:')).toEqual([`card:stop:${IDS.builder}`, `card:stop:${IDS.reviewer}`])
    // beside Open: both in the card's head
    expect(await ui.find({ key: `card:open:${IDS.builder}` })).toBeDefined()
    await ui.press({ key: 'stop:turn' })
    expect(w.toasts[w.toasts.length - 1]).toBe('Sample data: nothing is stopped. Back to this chat to stop your turn.')
    await ui.press({ key: `card:stop:${IDS.builder}` })
    expect(w.toasts[w.toasts.length - 1]).toBe('Sample data: nothing is stopped. Back to this chat to stop your agents.')
    // builder's page: Stop, and what a press does
    await ui.press({ key: W.agentKeyOf(IDS.builder) })
    await ui.redraw()
    expect((await ui.find({ key: 'page:stop' }))?.props).toMatchObject({ label: 'Stop' })
    expect((await ui.find({ key: 'page:stopline' }))?.text).toContain("Claude Code's own TaskStop ends it")
    await ui.press({ key: 'key:b' })
    await ui.redraw()
    // the Orchestrator's page: why none
    await ui.press({ key: W.agentKeyOf(M.MAIN) })
    await ui.redraw()
    expect(await ui.find({ key: 'page:stop' })).toBeUndefined()
    expect((await ui.find({ key: 'page:stopline' }))?.text).toContain('The Orchestrator stops with its turn: Stop turn ends it')
    await ui.press({ key: 'key:b' })
    await ui.unmount()
  }
})

test('between turns no Stop turn; Chat draws what you stopped as a line of its own, never a bubble of yours', async ($, on) => {
  await demo($, on, state => ({
    ...state,
    header: { ...state.header, turn: null },
    chat: [...state.chat, { id: 'stop1', at: state.now, from: 'you', to: IDS.builder, who: 'You → builder', kind: 'stop', text: 'You stopped builder' }],
  }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ key: 'stop:turn' })).toBeUndefined()
    await ui.press({ key: 'tab:chat' })
    await ui.redraw()
    const line = (await ui.findAll({ type: 'Text' })).find(one => one.text.startsWith('You stopped builder'))
    expect(line?.text).toMatch(/^You stopped builder · (now|\d+[mh])$/)
    await ui.unmount()
  }
})
