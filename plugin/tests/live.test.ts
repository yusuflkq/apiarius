import type { AgentInfo, Args, On, ToolCallResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import { timelineOf } from '../hooks/timeline'
import * as W from '../hooks/web'
import type { DeckSnapshot } from '../types'

/**
 * What the live QA run (a scout, a fixer with a foreground helper, and a
 * reviewer, read through `.debug/state.json`) caught, replayed through the
 * hooks: each test failed before its fix.
 */

const NOW = 1_700_000_100_000
const REPORT = 'Finished: the data layer and its query functions are in, and all checks are green.'

/** An agent spawn as the engine raises it: `agent-<name>`, under `parent` when given. */
function spawned(name: string, description: string, parent?: string): Args<'agent.spawn'> {
  return {
    tool_use_id: `toolu_${name}`,
    prompt: `You are ${name}.`,
    description,
    subagentType: 'general-purpose',
    name,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-test',
    background: parent === undefined,
    fork: false,
    ...(parent !== undefined ? { parentAgentId: parent } : {}),
  }
}

/** A SubagentHandback call in `agentId`'s loop: a tool this build's table does not list. */
function handback(agentId: string, message: string): Args<'tool.call'> {
  return { tool: 'SubagentHandback', message, agentId } as unknown as Args<'tool.call'>
}

/** The engine in Claude Code's place, outside a repository; `listed` is what `$.agent.list` answers, `saved` each snapshot the deck keeps, `ended` what a call ends with other than ok, by its tool_use_id. */
function world(on: On, saved: DeckSnapshot[], listed: Map<string, AgentInfo>, ended: Record<string, ToolCallResult> = {}) {
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [] } }))
  on('agent.list', () => ({ value: [...listed.values()] }))
  on('agent.spawn', ($, e) => {
    const id = `agent-${e.name ?? 'x'}`
    listed.set(id, { id, name: e.name, description: e.description, type: e.subagentType, status: 'running', ...(e.parentAgentId ? { parentId: e.parentAgentId } : {}) })
    return { model: 'claude-haiku', agentId: id }
  })
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($, e) => ended[e.tool_use_id] ?? { result: 'ok' })
  let version = 0
  on('state.get', { plugin: 'apiarius', key: 'snapshot' }, () => ({ value: { value: undefined, version } }))
  on('state.set', { plugin: 'apiarius', key: 'snapshot' }, ($, e) => {
    saved.push(JSON.parse(JSON.stringify(e.value)) as DeckSnapshot)
    version += 1
    return { value: { isSet: true as const, version } }
  })
}

function lastOf(saved: readonly DeckSnapshot[]): DeckSnapshot {
  const last = saved[saved.length - 1]
  if (!last) throw new Error('the deck kept no snapshot')
  return last
}

test('Live QA 1: an agent the engine lists as waiting while its foreground child runs is busy, not waiting on you', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  const listed = new Map<string, AgentInfo>()
  world(on, saved, listed)

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.agent.spawn(spawned('fixer', 'fixer: fix the bug and test it'))
  await $.agent.spawn(spawned('helper', 'helper: add a README line', 'agent-fixer'))
  // a background subagent held on its Agent call alone: what $.agent.list says of it
  const fixerInfo = listed.get('agent-fixer')
  if (fixerInfo) listed.set('agent-fixer', { ...fixerInfo, status: 'waiting' })
  // the tick folds the list in (2.5 s), and the snapshot keeps it (1.5 s later)
  await clock.advance(4500)

  const { data } = lastOf(saved)
  const fixer = M.agentOf(data, 'agent-fixer')
  expect(fixer?.status).toBe('waiting')
  expect(M.statusOf(fixer!, data)).toBe('running')
  // its row in the deck's tree: at work, nothing of its waiting on you
  const row = W.agentRowsOf(data, NOW + 4500).find(one => one.row === 'agent' && one.id === 'agent-fixer')
  expect(row).toMatchObject({ status: 'running', needs: 0 })
  expect(M.summaryOf(data, emptyGit(), NOW + 4500)).toMatchObject({ running: 2, waiting: 0 })
  expect(M.needsOf(data, emptyGit()).kind).toBe('none')
})

test('Live QA 2: an agent that answers in plain text, then hands the same report back when the engine asks, keeps one result message', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved, new Map())

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.agent.spawn(spawned('data', 'v3 data: goal, plan, checklists'))
  // its turn ends with the report as its answer, not handed back
  await $.turn.complete({ turnId: 'turn-data', answer: REPORT, durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-data' })
  // the engine asks for the hand-back: its loop runs again and hands the same report back
  await $.tool.call(handback('agent-data', REPORT))
  await $.turn.complete({ turnId: 'turn-data-2', answer: '', durationMs: 500, isAborted: false, reason: 'answer', agentId: 'agent-data' })
  await clock.advance(2000)

  const data = lastOf(saved).data
  const results = data.messages.filter(message => message.kind === 'result')
  expect(results.map(message => [message.from, message.to, message.text])).toEqual([['agent-data', M.MAIN, REPORT]])
  expect(M.agentOf(data, 'agent-data')).toMatchObject({ status: 'completed', answer: REPORT, resultVia: 'handback' })
})

test('Live QA 3: a hand-back that starts the Orchestrator`s next turn is the agent`s result, not a prompt of yours', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved, new Map())

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'Fix the off-by-one in src/retry.js', origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text: 'Fix the off-by-one in src/retry.js', turnId: 't1' })
  await $.agent.spawn(spawned('scout', 'scout: find the planted bug'))
  await $.turn.complete({ turnId: 't1', answer: 'scout is on it.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await $.tool.call(handback('agent-scout', REPORT))
  // the hand-back reaches the idle Orchestrator as a turn of its own, from the agent
  const delivery = `<agent-message from="agent-scout">\n[Subagent hand-back] The text below is the final report of a subagent.\n  ${REPORT}\n</agent-message>`
  await $.prompt.submit({ text: delivery, origin: { kind: 'peer' }, wait: false })
  await $.turn.start({ text: delivery, turnId: 't2' })
  await clock.advance(2000)

  const data = lastOf(saved).data
  expect(data.messages.map(message => [message.from, message.to, message.kind])).toEqual([
    [M.YOU, M.MAIN, 'prompt'],
    [M.MAIN, 'agent-scout', 'spawn'],
    // the Orchestrator's answer is its reply to you
    [M.MAIN, M.YOU, 'answer'],
    ['agent-scout', M.MAIN, 'result'],
  ])
  // a prompt in your own words still is yours
  await $.prompt.submit({ text: 'Now commit it', origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text: 'Now commit it', turnId: 't3' })
  await clock.advance(2000)
  expect(lastOf(saved).data.messages.filter(message => message.from === M.YOU).map(message => message.text)).toEqual(['Fix the off-by-one in src/retry.js', 'Now commit it'])
})

/** Claude Code's prompt suggestion's loop, as a real session's dump held it: a fork with no spawn, no task (the list never names it) and no SubagentStart. */
const FORK = 'aeec0d50e30ef62df'

/** A call in a loop no spawn named. */
function loopCall(agentId: string, tool: string, input: Record<string, unknown>): Args<'tool.call'> {
  return { tool, tool_use_id: `toolu_${agentId}_${tool}`, ...input, agentId } as unknown as Args<'tool.call'>
}

test('Live QA 4: Claude Code`s own fork (a prompt suggestion: no spawn, no list, no SubagentStart, its SubagentStop`s type empty, its last words a guess at your next prompt) is no agent: no card, Org node, lane, chat row or band count while it runs, and gone once it ends; a forked skill the list names, and a loop SubagentStart names, are agents', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  const listed = new Map<string, AgentInfo>()
  world(on, saved, listed)
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  const stateNow = async () => W.deckStateOf(lastOf(saved).data, emptyGit(), null, clock.now(), 'session-1', '/work')

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ask = 'spin up some agents i wanna see what they look like'
  await $.prompt.submit({ text: ask, origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text: ask, turnId: 't1' })
  await $.agent.spawn(spawned('explorer', 'Explore working directory'))
  await $.classic.SubagentStart({ agent_id: 'agent-explorer', agent_type: 'general-purpose' })
  await $.turn.complete({ turnId: 't1', answer: 'One agent is running in the background now.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-explorer', agent_transcript_path: '', agent_type: 'general-purpose', last_assistant_message: 'The folder is empty.' })

  // the turn over, Claude Code guesses your next prompt in a fork of its own: it reaches for a tool (refused it), then says its guess
  await $.tool.call(loopCall(FORK, 'ToolSearch', { query: 'select:SendMessage', max_results: 1 }))
  await clock.advance(3000)
  // the list, read while it runs, does not name it: Claude Code's own, shown nowhere
  expect(M.agentOf(lastOf(saved).data, FORK)?.origin).toBe('engine')
  let state = await stateNow()
  expect(state.agents.some(row => row.id === FORK)).toBe(false)
  expect([state.header.state, W.bandOf(state), state.figures.running]).toEqual(['idle', null, 0])
  expect(state.activity.some(one => one.agent === FORK)).toBe(false)
  expect(timelineOf(lastOf(saved).data, state).lanes.some(lane => lane.id === FORK)).toBe(false)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: FORK, agent_transcript_path: '', agent_type: '', last_assistant_message: 'spin up a couple more' })
  await clock.advance(2000)
  // ended: forgotten, its guess no words to the Orchestrator
  let data = lastOf(saved).data
  expect(M.agentOf(data, FORK)).toBeUndefined()
  expect(data.messages.some(message => message.text.includes('spin up a couple more'))).toBe(false)
  state = await stateNow()
  expect(state.chat.map(row => row.who)).toEqual(['You → Orchestrator', 'Orchestrator → explorer', 'Orchestrator → you', 'explorer → Orchestrator'])

  // a compaction's fork that ends with its turn, no SubagentStop: gone as well
  await $.tool.call(loopCall('fork-compact', 'Grep', { pattern: 'TODO' }))
  await $.turn.complete({ turnId: 'tc', answer: 'The conversation so far, summarised.', durationMs: 500, isAborted: false, reason: 'answer', agentId: 'fork-compact' })
  await clock.advance(2000)
  data = lastOf(saved).data
  expect(M.agentOf(data, 'fork-compact')).toBeUndefined()
  expect(data.messages.some(message => message.from === 'fork-compact')).toBe(false)

  // a forked skill: no spawn, but Claude Code starts it as an agent (SubagentStart, its type) and tracks it as one (the list): an agent, its result Chat's
  listed.set('askill01', { id: 'askill01', description: 'Review the diff', type: 'general-purpose', status: 'running' })
  await $.classic.SubagentStart({ agent_id: 'askill01', agent_type: 'general-purpose' })
  await $.tool.call(loopCall('askill01', 'Grep', { pattern: 'TODO' }))
  await clock.advance(3000)
  state = await stateNow()
  expect(state.agents.find(row => row.id === 'askill01')).toMatchObject({ kind: 'agent', title: 'Review the diff', type: 'general-purpose', status: 'running' })
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'askill01', agent_transcript_path: '', agent_type: 'general-purpose', last_assistant_message: 'Two TODOs are left.' })
  await clock.advance(2000)
  state = await stateNow()
  expect(state.chat.at(-1)).toMatchObject({ from: 'askill01', to: M.MAIN, kind: 'result', text: 'Two TODOs are left.' })

  // a loop its first call showed before SubagentStart named it, which the list leaves out (it no longer tracks it): an agent from then on
  await $.tool.call(loopCall('agent-late', 'Grep', { pattern: 'retry' }))
  await $.classic.SubagentStart({ agent_id: 'agent-late', agent_type: 'Explore' })
  await clock.advance(2000)
  state = await stateNow()
  expect(state.agents.find(row => row.id === 'agent-late')).toMatchObject({ kind: 'agent', status: 'running' })
  expect(W.bandOf(state)?.text).toBe('● 1 working')
})

test('an Agent call that errors before any agent starts ("Cannot create agent worktree") is no agent: no card, Org node, lane or band count, only the Orchestrator`s failed call in its Activity; the agent a later call starts under the same description is', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  const WHY = 'Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are configured.'
  world(on, saved, new Map(), { toolu_failed: { isError: true, result: `Error: ${WHY}`, text: WHY } as never })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ text: 'Build the redesigned Timeline', turnId: 't1' })
  await $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_failed', description: 'Build the redesigned Timeline', prompt: 'Build it.', subagent_type: 'general-purpose', isolation: 'worktree' } as unknown as Args<'tool.call'>)
  await clock.advance(2000)
  let data = lastOf(saved).data
  expect(M.agentOf(data, 'toolu_failed')).toBeUndefined()
  expect(M.agentOf(data, M.MAIN)?.recent.map(one => [one.id, one.tool, one.target, one.ok])).toEqual([['toolu_failed', 'Agent', 'Build the redesigned Timeline', false]])
  let state = W.deckStateOf(data, emptyGit(), null, NOW + 2000, 'session-1', '/work')
  expect(state.agents.map(row => row.id)).toEqual([M.MAIN])
  expect(state.activity.map(one => [one.agent, one.tool, one.text, one.ok])).toEqual([[M.MAIN, 'Agent', 'Build the redesigned Timeline', false]])
  expect(timelineOf(data, state).lanes.map(lane => lane.id)).toEqual([M.MAIN])

  // the call again, without the worktree: an agent starts, and it is the one agent of that name
  await $.agent.spawn({ ...spawned('timeline', 'Build the redesigned Timeline'), tool_use_id: 'toolu_again' })
  await clock.advance(2000)
  data = lastOf(saved).data
  state = W.deckStateOf(data, emptyGit(), null, NOW + 4000, 'session-1', '/work')
  expect(state.agents.flatMap(row => (row.row === 'agent' ? [[row.id, row.title, row.status]] : []))).toEqual([
    [M.MAIN, 'Orchestrator', 'running'],
    ['agent-timeline', 'timeline', 'running'],
  ])
})

test('a reload forgets what a snapshot kept of Claude Code`s own loops once they ended (the prompt suggestion`s row and its guess as a result to the Orchestrator) and of Agent calls that started no agent (their stopped rows); the agents, a loop still at work and a call in a cloud session stay', () => {
  const data = M.emptyData(NOW - 600_000)
  // as two real sessions' dumps held them
  const explorer = M.addPlaceholder(data, { toolUseId: 'toolu_explore', parentId: M.MAIN, description: 'Explore working directory', prompt: 'Look around.', type: 'Explore', at: NOW - 500_000 })
  M.bindAgent(data, explorer, 'a283c02285180ef71')
  M.noteResult(data, explorer, 'The folder is empty.', NOW - 400_000, 'handback')
  const fork = M.ensureAgent(data, FORK, NOW - 300_000, 'engine')
  M.noteResult(data, fork, 'spin up a couple more', NOW - 290_000, 'stop')
  Object.assign(fork, { status: 'completed', endedAt: NOW - 290_000 })
  M.ensureAgent(data, 'fork-live', NOW - 1000, 'engine')
  for (const [id, description] of [['toolu_01LCGGZyKiUpmrC8RMYYeB3W', 'Build peer sessions rail and switcher'], ['toolu_01Pvwu8i7RYpyqn243vmFsbv', 'Build the redesigned Timeline']] as const) {
    const failed = M.addPlaceholder(data, { toolUseId: id, parentId: M.MAIN, description, prompt: 'Build it.', at: NOW - 200_000 })
    Object.assign(failed, { status: 'killed', endedAt: NOW - 199_000 })
  }
  M.addPlaceholder(data, { toolUseId: 'toolu_cloud', parentId: M.MAIN, description: 'Run it in the cloud', prompt: 'Go.', at: NOW - 100_000 })
  M.settleAgentCall(data, { toolUseId: 'toolu_cloud', isStarted: true, isRemote: true, at: NOW - 99_000 })

  const healed = M.healData(M.copyOf(data), NOW)
  expect(healed.agents.map(agent => agent.id)).toEqual([M.YOU, M.MAIN, 'a283c02285180ef71', 'fork-live', 'toolu_cloud'])
  expect(healed.messages.map(message => [message.from, message.to, message.kind, message.text])).toEqual([['a283c02285180ef71', M.MAIN, 'result', 'The folder is empty.']])
  // the loop still at work stays, shown nowhere: its stop (or the list) settles it
  const state = W.deckStateOf(healed, emptyGit(), null, NOW, 'session-1', '/work')
  expect(state.agents.flatMap(row => (row.row === 'agent' ? [row.id] : []))).toEqual([M.MAIN, 'a283c02285180ef71', 'toolu_cloud'])
})
