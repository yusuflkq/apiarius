import type { On } from 'claude-code'
import { expect, mock, test, type Engine, type MockClock } from 'claude-code/testing'

import * as M from '../hooks/model'
import type { DeckAgent, DeckData, DeckSnapshot } from '../types'

/**
 * The engine's events as the deck reads them: whose turn a `turn.start` is
 * (engine 2.1.304 raises it for a subagent's and a teammate's runs too, with
 * `agentId`), and the main loop's running turn, which Stop turn ends; the
 * chat's rows (your prompts typed mid-turn, Claude Code's notifications, a
 * background task's notification, a SendMessage titled by its summary,
 * addressees never made up); the needs Claude Code's notifications raise;
 * each spawn's background flag; and the approved plan as Claude wrote it.
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
  // a prompt submitted while idle starts its turn inside prompt.submit, as the engine does, while held (`submitStarting`)
  on('prompt.submit', async ($, e) => {
    if (submitting.isHeld) {
      await new Promise<void>(resolve => {
        submitting.release = resolve
      })
    }
    return { text: e.text }
  })
  // a send to a finished agent resumes it inside the send, as the engine does, while one is set (`resuming.run`)
  on('session.send', async () => {
    const run = resuming.run
    resuming.run = undefined
    if (run) await run()
    return { isDelivered: true }
  })
  on('session.receive', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 12, mtimeMs: NOW, isLink: false } }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => ran(128, ''))
  // a SendMessage's tool holds its call open while the test raises the send it makes inside it (`sendInside`)
  on('tool.call', async ($, e) => {
    if ((e.tool as string) === 'SendMessage') {
      await new Promise<void>(resolve => {
        sending.release = resolve
      })
      return { result: { success: true } }
    }
    return { result: 'ok' }
  })
  let version = 0
  on('state.get', { plugin: 'agent-deck', key: 'snapshot' }, () => ({ value: { value: undefined, version } }))
  on('state.set', { plugin: 'agent-deck', key: 'snapshot' }, ($, e) => {
    saved.push(JSON.parse(JSON.stringify(e.value)) as DeckSnapshot)
    version += 1
    return { value: { isSet: true as const, version } }
  })
}

/** Lets the SendMessage call held open end. */
const sending: { release?: () => void } = {}

/** The resume a send raises inside itself, once. */
const resuming: { run?: () => Promise<unknown> } = {}

/** Holds prompt.submit open while the test starts its turn inside it, then lets it end. */
const submitting: { isHeld: boolean; release?: () => void } = { isHeld: false }

/**
 * A prompt submitted while the session is idle, as the engine runs it: its
 * turn starts (turn.start) inside prompt.submit, before `next(e)` resolves;
 * then the turn ends, answered or interrupted.
 */
async function submitStarting($: Engine, clock: MockClock, prompt: { text: string; origin: { kind: 'composer' } | { kind: 'task-notification' } | { kind: 'peer' }; wait: boolean }, turnId: string, reason: 'answer' | 'aborted') {
  submitting.isHeld = true
  const submitted = $.prompt.submit(prompt)
  await clock.settle()
  await $.turn.start({ text: prompt.text, turnId })
  submitting.isHeld = false
  submitting.release?.()
  await submitted
  await $.turn.complete({ turnId, answer: reason === 'answer' ? `Done with ${turnId}.` : '', durationMs: 1000, isAborted: reason === 'aborted', reason })
  await clock.settle()
}

/** A SendMessage call of loop `agentId`, its session.send raised inside it as the engine's tool raises it. */
async function sendInside($: Engine, clock: MockClock, call: { to: string; message: string; summary?: string; agentId: string }) {
  const called = $.tool.call({ tool: 'SendMessage', ...call } as never)
  await clock.settle()
  await $.session.send({ to: call.to, text: call.message, origin: { kind: 'model' }, agentId: call.agentId })
  sending.release?.()
  await called
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

test('the main loop`s running turn: kept from its turn.start to its turn.complete with when it started, healed from a snapshot only as a string and a time', () => {
  const data = M.emptyData(NOW)
  M.noteMainTurn(data, 't1', NOW - 5000)
  expect(data.mainTurnId).toBe('t1')
  expect(data.mainTurnAt).toBe(NOW - 5000)
  // an older turn's end leaves the newer one in place
  M.endMainTurn(data, 't0')
  expect(data.mainTurnId).toBe('t1')
  M.endMainTurn(data, 't1')
  expect(data.mainTurnId).toBeUndefined()
  expect(data.mainTurnAt).toBeUndefined()
  M.noteMainTurn(data, 't2', NOW - 1000)
  expect(M.healData(M.copyOf(data), NOW)).toMatchObject({ mainTurnId: 't2', mainTurnAt: NOW - 1000 })
  expect(M.healData({ ...M.copyOf(data), mainTurnId: 7 as unknown as string }, NOW).mainTurnId).toBeUndefined()
  // no turn, no time; a time that is no number goes, the turn stays
  expect(M.healData({ ...M.copyOf(data), mainTurnId: 7 as unknown as string }, NOW).mainTurnAt).toBeUndefined()
  const healed = M.healData({ ...M.copyOf(data), mainTurnAt: 'soon' as unknown as number }, NOW)
  expect(healed.mainTurnId).toBe('t2')
  expect(healed.mainTurnAt).toBeUndefined()
})


/** The chat's rows as [from, to, kind, title, text]. */
function rowsOf(data: DeckData): [string, string, string, string, string][] {
  return data.messages.map(one => [one.from, one.to, one.kind, one.title ?? '', one.text])
}

test('a prompt typed over the running turn is logged when you send it, once: the turn it starts later logs it no second time', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.prompt.submit(typed('Map the repository'))
  await $.turn.start({ text: 'Map the repository', turnId: 't1' })
  await clock.advance(1000)
  await $.prompt.submit(typed('Also note the test runner', 't1'))
  await clock.advance(1000)
  // logged now, while the turn runs
  expect(promptsOf(lastOf(saved))).toEqual(['Map the repository', 'Also note the test runner'])
  await $.turn.complete({ turnId: 't1', answer: 'Mapped.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await $.turn.start({ text: 'Also note the test runner', turnId: 't2' })
  await clock.advance(2000)
  expect(promptsOf(lastOf(saved))).toEqual(['Map the repository', 'Also note the test runner'])
  // two typed over one turn may start the next together: still once each
  await $.prompt.submit(typed('Then the docs', 't2'))
  await $.prompt.submit(typed('And the changelog', 't2'))
  await $.turn.complete({ turnId: 't2', answer: 'Noted.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await $.turn.start({ text: 'Then the docs\n\nAnd the changelog', turnId: 't3' })
  // the same words typed again while idle are a new prompt
  await $.turn.complete({ turnId: 't3', answer: 'Done.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await $.prompt.submit(typed('Then the docs'))
  await $.turn.start({ text: 'Then the docs', turnId: 't4' })
  await clock.advance(2000)
  expect(promptsOf(lastOf(saved))).toEqual(['Map the repository', 'Also note the test runner', 'Then the docs', 'And the changelog', 'Then the docs'])
})

test('your prompt after an interrupted notification`s turn is yours: each prompt of yours a row once, though each turn starts inside its prompt`s submit', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  await submitStarting($, clock, typed('spin up three agents and make one secretly evil'), 't1', 'answer')
  // an agent's hand-back and then its task's notification each start a turn; you interrupt the last
  await submitStarting($, clock, { text: 'Another Claude session sent a message:\n<agent-message from="agent-bravo">\n[Subagent hand-back] core.py is done.\n</agent-message>', origin: { kind: 'peer' }, wait: false }, 't2', 'answer')
  await submitStarting($, clock, { text: '<task-notification>\n<task-id>agent-bravo</task-id>\n<status>completed</status>\n<summary>Agent "Bravo" finished</summary>\n</task-notification>', origin: { kind: 'task-notification' }, wait: false }, 't3', 'aborted')
  // "Interrupted · What should Claude do instead?": your steering
  await submitStarting($, clock, typed('no this is not what i wanted: three plain agents that talk to each other'), 't4', 'answer')
  await clock.advance(2000)

  const data = lastOf(saved)
  expect(promptsOf(data)).toEqual(['spin up three agents and make one secretly evil', 'no this is not what i wanted: three plain agents that talk to each other'])
  expect(data.goals.map(goal => goal.text).slice(-1)).toEqual(['no this is not what i wanted: three plain agents that talk to each other'])
  // the hand-back and the notification are no words of yours
  expect(data.messages.some(one => one.from === M.YOU && one.text.includes('hand-back'))).toBe(false)
})

test('/login run alone is the command you ran, a row of its own and never a prompt of yours or a goal, whether a turn starts with it or it was typed over a running one', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  await submitStarting($, clock, typed('hi spin up an orchestrator and 3 agents'), 't1', 'answer')
  // "Login expired · Please run /login": the command, then the turn the engine runs again with it
  await submitStarting($, clock, { ...typed('/login'), command: { name: 'login', args: '' } } as never, 't2', 'answer')
  // typed over a running turn, the engine naming the command
  await submitStarting($, clock, typed('now the real work'), 't3', 'answer')
  await $.turn.start({ text: 'and go on', turnId: 't4' })
  await $.prompt.submit({ ...typed('/model opus', 't4'), command: { name: 'model', args: 'opus' } } as never)
  await clock.advance(2000)

  const data = lastOf(saved)
  expect(data.messages.filter(one => one.from === M.YOU).map(one => [one.kind, one.to, one.text])).toEqual([
    ['prompt', M.MAIN, 'hi spin up an orchestrator and 3 agents'],
    ['command', '', '/login'],
    ['prompt', M.MAIN, 'now the real work'],
    ['prompt', M.MAIN, 'and go on'],
    ['command', '', '/model opus'],
  ])
  expect(data.goals.map(goal => goal.text)).toEqual(['hi spin up an orchestrator and 3 agents', 'now the real work'])
})

test('a SendMessage that wakes a finished agent is one message row, no spawn: the agent resumed, its task kept, whether its resume comes inside the send, after it, or with no send', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit(typed('Play the imposter game with three players'))
  await $.turn.start({ text: 'Play the imposter game with three players', turnId: 't1' })
  await $.agent.spawn(spawnOf('red', 'You are player Red. Give your first clue.'))
  await $.turn.complete({ turnId: 'turn-red', answer: 'RED: the quiet piece decides.', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-red' })
  await clock.advance(60_000)
  const startedAt = M.agentOf(lastOf(saved), 'agent-red')!.startedAt

  // round 1: the Orchestrator's SendMessage to Red, finished, resumes it inside the send
  const round1 = 'ROUND 1 messages:\n- BLUE: "the quietest piece decides"\nGive your round-2 message.'
  resuming.run = () => $.agent.spawn({ ...spawnOf('red', round1), resume: { agentId: 'agent-red' } })
  await $.session.send({ to: 'agent-red', text: round1, origin: { kind: 'model' } })
  await clock.advance(2000)
  let red = M.agentOf(lastOf(saved), 'agent-red')!
  expect([red.status, red.prompt, red.startedAt, red.resumedAt]).toEqual(['running', 'You are player Red. Give your first clue.', startedAt, NOW + 60_000])
  await $.turn.complete({ turnId: 'turn-red-2', answer: 'RED round 2: I open with the king pawn.', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-red' })

  // round 2: the send logged first, the resume after it
  const round2 = 'ROUND 2 messages:\n- BLUE: "pure skill"\nGive your round-3 message.'
  await $.session.send({ to: 'red', text: round2, origin: { kind: 'model' } })
  await $.agent.spawn({ ...spawnOf('red', round2), resume: { agentId: 'agent-red' } })
  await $.turn.complete({ turnId: 'turn-red-3', answer: 'RED round 3.', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-red' })
  // Claude Code brings it back with words of its own and no send
  await $.agent.spawn({ ...spawnOf('red', 'Continue from where you stopped.'), resume: { agentId: 'agent-red' } })
  await clock.advance(2000)

  const data = lastOf(saved)
  expect(data.messages.filter(one => one.to === 'agent-red').map(one => [one.from, one.kind, one.text])).toEqual([
    [M.MAIN, 'spawn', 'You are player Red. Give your first clue.'],
    [M.MAIN, 'message', round1],
    [M.MAIN, 'message', round2],
    [M.MAIN, 'message', 'Continue from where you stopped.'],
  ])
  red = M.agentOf(data, 'agent-red')!
  expect([red.status, red.prompt, red.description, red.startedAt]).toEqual(['running', 'You are player Red. Give your first clue.', 'red work', startedAt])
  expect(red.resumedAt).toBeGreaterThan(NOW + 60_000)
  // one agent, never a second row for a resume
  expect(data.agents.filter(one => one.name === 'red').length).toBe(1)
})

test('an agent`s SendMessage that wakes a finished agent comes to it in an envelope (<agent-message from="…">): still one row, from that agent, in its own words, whether the resume comes inside the send or with no send the deck saw', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit(typed('Have alice and bob talk'))
  await $.turn.start({ text: 'Have alice and bob talk', turnId: 't1' })
  await $.agent.spawn(spawnOf('alice', 'Wait for a message, then reply.'))
  await $.agent.spawn(spawnOf('bob', 'Greet alice.'))
  await $.turn.complete({ turnId: 'turn-alice', answer: 'Nothing came.', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-alice' })
  await clock.advance(2000)

  // bob's send to alice, finished, resumes her inside the send, its words in their envelope
  resuming.run = () => $.agent.spawn({ ...spawnOf('alice', '<agent-message from="agent-bob">\nhi alice from bob\n</agent-message>'), resume: { agentId: 'agent-alice' } })
  await $.session.send({ to: 'agent-alice', text: 'hi alice from bob', origin: { kind: 'model' }, agentId: 'agent-bob' } as never)
  await clock.advance(2000)
  await $.turn.complete({ turnId: 'turn-alice-2', answer: 'Replied.', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-alice' })
  // Claude Code brings her back with bob's words in their envelope, and no send the deck saw
  await $.agent.spawn({ ...spawnOf('alice', '<agent-message from="agent-bob">\nare you there?\n</agent-message>'), resume: { agentId: 'agent-alice' } })
  await clock.advance(2000)

  const data = lastOf(saved)
  expect(data.messages.filter(one => one.to === 'agent-alice' && one.kind === 'message').map(one => [one.from, one.text])).toEqual([
    ['agent-bob', 'hi alice from bob'],
    ['agent-bob', 'are you there?'],
  ])
})

test('Claude Code`s notifications are rows from Claude Code to you, as it sent them (a type the deck does not know too); those that ask something are needs, each taken down when what it waits on moves; an idle prompt is neither', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.prompt.submit(typed('Map the repository'))
  await $.turn.start({ text: 'Map the repository', turnId: 't1' })
  await $.agent.spawn(spawnOf('scout', 'Find the entry points'))
  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts', agentId: 'agent-scout' } as never)
  await $.turn.complete({ turnId: 't1', answer: 'Scout is on it.', durationMs: 1000, isAborted: false, reason: 'answer' })

  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt', agent_id: 'agent-scout', title: 'Permission needed' } as never)
  await $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })
  await $.classic.Notification({ message: 'Your build of the skill finished', notification_type: 'skill_build' })
  await clock.advance(2000)
  let data = lastOf(saved)
  // Claude Code saying its turn ended (an idle prompt) is no row: nothing in it asks or tells anything new
  expect(rowsOf(data).filter(one => one[2] === 'notification')).toEqual([
    ['engine', 'you', 'notification', 'Permission needed', 'Claude needs your permission to use Bash'],
    ['engine', 'you', 'notification', 'skill_build', 'Your build of the skill finished'],
  ])
  expect(data.messages.find(one => one.kind === 'notification')?.agent).toBe('agent-scout')
  // the one that asks is a need, in its own words; the idle prompt and the third ask nothing
  expect(data.needs.map(one => [one.kind, one.agent ?? 'main', one.text])).toEqual([['permission_prompt', 'agent-scout', 'Claude needs your permission to use Bash']])
  expect(mainIn(data).needs?.kind).toBe('permission_prompt')

  // your next turn leaves scout's permission prompt as it was
  await $.prompt.submit(typed('Go on'))
  await $.turn.start({ text: 'Go on', turnId: 't2' })
  await clock.advance(2000)
  data = lastOf(saved)
  expect(data.needs.map(one => one.kind)).toEqual(['permission_prompt'])
  expect(mainIn(data).needs?.kind).toBe('permission_prompt')
  // scout moves on: its prompt was answered
  await $.tool.call({ tool: 'Grep', pattern: 'main', agentId: 'agent-scout' } as never)
  await clock.advance(2000)
  data = lastOf(saved)
  expect(data.needs).toEqual([])
  expect(mainIn(data).needs).toBeUndefined()
})

test('a background task`s notification is a row from Claude Code to the main loop, its summary verbatim, about the agent whose task it is: once, whether it came by prompt.submit, by the turn it starts, or both', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.prompt.submit(typed('Map the repository'))
  await $.turn.start({ text: 'Map the repository', turnId: 't1' })
  await $.agent.spawn(spawnOf('scout', 'Find the entry points'))
  await $.turn.complete({ turnId: 't1', answer: 'Scout is on it.', durationMs: 1000, isAborted: false, reason: 'answer' })
  const notice = (id: string, call: string, summary: string) =>
    `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>${call}</tool-use-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`
  const scoutDone = notice('agent-scout', 'toolu_scout', 'Agent "scout" completed')
  await $.prompt.submit({ text: scoutDone, origin: { kind: 'task-notification' }, wait: false })
  await $.turn.start({ text: scoutDone, turnId: 't2' })
  await $.turn.complete({ turnId: 't2', answer: 'Scout found them.', durationMs: 1000, isAborted: false, reason: 'answer' })
  // a shell's, starting a turn with no prompt.submit before it
  await $.turn.start({ text: notice('bk81x2', 'toolu_shell', 'Background command "npm test" completed (exit code 0)'), turnId: 't3' })
  await clock.advance(2000)
  const data = lastOf(saved)
  expect(rowsOf(data).filter(one => one[2] === 'task')).toEqual([
    ['engine', 'main', 'task', 'completed', 'Agent "scout" completed'],
    ['engine', 'main', 'task', 'completed', 'Background command "npm test" completed (exit code 0)'],
  ])
  expect(data.messages.filter(one => one.kind === 'task').map(one => one.agent ?? '')).toEqual(['agent-scout', ''])
  // none of it is a prompt of yours
  expect(promptsOf(data)).toEqual(['Map the repository'])
  expect(M.taskNoticesOf('no notice here')).toEqual([])
})

test('a SendMessage`s row is titled by its own summary; a name no agent carries stays the name it was sent to; an agent`s words after your message go to nobody in particular', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.prompt.submit(typed('Fix and review'))
  await $.turn.start({ text: 'Fix and review', turnId: 't1' })
  await $.agent.spawn(spawnOf('fixer', 'Fix the bug'))
  await $.agent.spawn(spawnOf('reviewer', 'Review the fix'))
  await sendInside($, clock, { to: 'reviewer', message: 'The fix is in src/a.ts: please look.', summary: 'Fix ready for review', agentId: 'agent-fixer' })
  await sendInside($, clock, { to: 'designer', message: 'Can you check the colours?', agentId: 'agent-fixer' })
  await $.session.receive({ origin: { kind: 'peer' }, text: '<agent-message from="auditor">\nAll clear.\n</agent-message>', agentId: 'agent-fixer' })
  await clock.advance(2000)
  const data = lastOf(saved)
  expect(rowsOf(data).filter(one => one[2] === 'message')).toEqual([
    ['agent-fixer', 'agent-reviewer', 'message', 'Fix ready for review', 'The fix is in src/a.ts: please look.'],
    ['agent-fixer', 'designer', 'message', '', 'Can you check the colours?'],
    ['auditor', 'agent-fixer', 'message', '', 'All clear.'],
  ])
  // no made-up node for a name nobody carries
  expect(data.agents.some(one => one.kind === 'peer')).toBe(false)
  expect(data.messages.every(one => !one.from.startsWith('peer:') && !one.to.startsWith('peer:'))).toBe(true)

  // the deck's words to the reviewer, then its next words: said, to nobody in particular
  M.addMessage(data, { from: M.YOU, to: 'agent-reviewer', kind: 'chat', text: 'Check the edge case', at: NOW })
  expect(M.linksOf({ ...data, messages: [{ id: 'm1', from: 'agent-reviewer', to: '', kind: 'chat', text: 'Looking at it now.', at: NOW }] }).size).toBe(0)
})

test('each spawn says whether it runs in the background; the approved plan is kept as Claude wrote it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.prompt.submit(typed('Plan it'))
  await $.turn.start({ text: 'Plan it', turnId: 't1' })
  await $.agent.spawn(spawnOf('scout', 'Find the entry points', true))
  await $.agent.spawn(spawnOf('helper', 'Help in the foreground', false))
  await clock.advance(2000)
  let data = lastOf(saved)
  expect(M.agentOf(data, 'agent-scout')?.background).toBe(true)
  expect(M.agentOf(data, 'agent-helper')?.background).toBe(false)

  // ExitPlanMode approved: its plan whole, even one that splits into no steps
  const plan = '# Plan\n\nJust do it, carefully.'
  await $.tool.call({ tool: 'ExitPlanMode', plan } as never)
  await clock.advance(2000)
  data = lastOf(saved)
  expect(data.approved).toEqual({ text: plan, at: NOW + 2000, by: 'main' })
  data = M.healData(M.copyOf(data), NOW)
  expect(data.approved?.text).toBe(plan)
  expect(M.agentOf(data, 'agent-helper')?.background).toBe(false)
  expect(M.healData({ ...M.copyOf(data), approved: { text: '', at: NOW, by: 'main' } }, NOW).approved).toBeUndefined()
})
