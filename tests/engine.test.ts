import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import * as M from '../hooks/model'
import type { DeckAgent, DeckData, DeckSnapshot } from '../types'

/**
 * The engine's events as the deck reads them: whose turn a `turn.start` is
 * (engine 2.1.304 raises it for a subagent's and a teammate's runs too, with
 * `agentId`), and the main loop's running turn, which Stop turn ends.
 */

const NOW = 1_700_000_100_000

/** Answers every engine call the deck makes, outside a repository; `saved` collects each snapshot the deck keeps in `$.state`. */
function world(on: On, saved: DeckSnapshot[]) {
  const ran = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } } }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', ($, e) => ({ model: 'claude-haiku', agentId: `agent-${e.name ?? 'x'}` }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('session.send', () => ({ isDelivered: true }))
  on('session.receive', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 12, mtimeMs: NOW, isLink: false } }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => ran(128, ''))
  on('tool.call', () => ({ result: 'ok' }))
  let version = 0
  on('state.get', { plugin: 'agent-deck', key: 'snapshot' }, () => ({ value: { value: undefined, version } }))
  on('state.set', { plugin: 'agent-deck', key: 'snapshot' }, ($, e) => {
    saved.push(JSON.parse(JSON.stringify(e.value)) as DeckSnapshot)
    version += 1
    return { value: { isSet: true as const, version } }
  })
}

function lastOf(saved: readonly DeckSnapshot[]): DeckData {
  const last = saved[saved.length - 1]
  if (!last) throw new Error('the deck kept no snapshot')
  return last.data
}

function mainIn(data: DeckData): DeckAgent {
  const main = M.agentOf(data, M.MAIN)
  if (!main) throw new Error('no Orchestrator')
  return main
}

/** The person types `text` at the prompt (over the running turn `turnId`, when given). */
function typed(text: string, turnId?: string) {
  return { text, origin: { kind: 'composer' as const }, wait: false, ...(turnId ? { turnId } : {}) }
}

/** The spawn an Agent call of the main loop's raises. */
function spawnOf(name: string, prompt: string, background = true) {
  return {
    tool_use_id: `toolu_${name}`,
    prompt,
    description: `${name} work`,
    subagentType: 'general-purpose',
    name,
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-test',
    background,
    fork: false,
  }
}

/** Your prompts to the Orchestrator, as logged. */
function promptsOf(data: DeckData): string[] {
  return data.messages.filter(one => one.from === M.YOU && one.kind === 'prompt').map(one => one.text)
}

test('a subagent`s turn.start is its own run: no prompt of yours is logged, the Orchestrator`s needs stay, it is not marked running, and the turn Stop turn ends stays main`s', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  await $.prompt.submit(typed('Map the repository'))
  await $.turn.start({ text: 'Map the repository', turnId: 't1' })
  await clock.advance(2000)
  expect(lastOf(saved).mainTurnId).toBe('t1')
  await $.agent.spawn(spawnOf('scout', 'Find the entry points'))
  await $.turn.complete({ turnId: 't1', answer: 'Scout is on it.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await clock.advance(2000)
  expect(lastOf(saved).mainTurnId).toBeUndefined()
  expect(mainIn(lastOf(saved)).status).toBe('idle')

  // Claude Code tells you it waits on you; then scout's run starts its own turn, with its brief
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  await $.turn.start({ text: 'Find the entry points', turnId: 'turn-scout', agentId: 'agent-scout' })
  await clock.advance(2000)

  let data = lastOf(saved)
  expect(promptsOf(data)).toEqual(['Map the repository'])
  expect(mainIn(data).needs).toMatchObject({ kind: 'permission_prompt', text: 'Claude needs your permission to use Bash' })
  expect(mainIn(data).status).toBe('idle')
  expect(data.mainTurnId).toBeUndefined()
  // the brief is logged once, as the spawn's
  expect(data.messages.filter(one => one.text === 'Find the entry points').map(one => [one.from, one.to, one.kind])).toEqual([['main', 'agent-scout', 'spawn']])

  // your next prompt is yours, and its turn is the one Stop turn ends, whatever turns its agents start
  await $.prompt.submit(typed('Now the tests'))
  await $.turn.start({ text: 'Now the tests', turnId: 't2' })
  await $.turn.start({ text: 'Keep going', turnId: 'turn-scout-2', agentId: 'agent-scout' })
  await clock.advance(2000)
  data = lastOf(saved)
  expect(promptsOf(data)).toEqual(['Map the repository', 'Now the tests'])
  expect(data.mainTurnId).toBe('t2')
  expect(mainIn(data).status).toBe('running')
  expect(mainIn(data).needs).toBeUndefined()
})

test('a subagent`s turn.start leaves the prompt the main loop`s next turn starts with as it was: one not in your words stays not yours', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.prompt.submit(typed('Map the repository'))
  await $.turn.start({ text: 'Map the repository', turnId: 't1' })
  await $.agent.spawn(spawnOf('scout', 'Find the entry points'))
  await $.turn.complete({ turnId: 't1', answer: 'Scout is on it.', durationMs: 1000, isAborted: false, reason: 'answer' })

  // another session's message is queued for the main loop; a subagent's run starts before the main loop takes it
  await $.prompt.submit({ text: 'Status from the other session: done', origin: { kind: 'peer' }, wait: false })
  await $.turn.start({ text: 'Keep going', turnId: 'turn-scout', agentId: 'agent-scout' })
  await $.turn.start({ text: 'Status from the other session: done', turnId: 't2' })
  await clock.advance(2000)

  expect(promptsOf(lastOf(saved))).toEqual(['Map the repository'])
})

test('the main loop`s running turn: kept from its turn.start to its turn.complete, healed from a snapshot only as a string', () => {
  const data = M.emptyData(NOW)
  M.noteMainTurn(data, 't1')
  expect(data.mainTurnId).toBe('t1')
  // an older turn's end leaves the newer one in place
  M.endMainTurn(data, 't0')
  expect(data.mainTurnId).toBe('t1')
  M.endMainTurn(data, 't1')
  expect(data.mainTurnId).toBeUndefined()
  M.noteMainTurn(data, 't2')
  expect(M.healData(M.copyOf(data), NOW).mainTurnId).toBe('t2')
  expect(M.healData({ ...M.copyOf(data), mainTurnId: 7 as unknown as string }, NOW).mainTurnId).toBeUndefined()
})
