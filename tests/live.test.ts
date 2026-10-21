import type { AgentInfo, Args, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
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

/** The engine in Claude Code's place, outside a repository; `listed` is what `$.agent.list` answers, `saved` each snapshot the deck keeps. */
function world(on: On, saved: DeckSnapshot[], listed: Map<string, AgentInfo>) {
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
  on('tool.call', () => ({ result: 'ok' }))
  let version = 0
  on('state.get', { plugin: 'agent-deck', key: 'snapshot' }, () => ({ value: { value: undefined, version } }))
  on('state.set', { plugin: 'agent-deck', key: 'snapshot' }, ($, e) => {
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
