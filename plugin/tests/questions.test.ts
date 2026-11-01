import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as M from '../hooks/model'
import * as W from '../hooks/web'
import type { DeckPending } from '../types'
import { bash } from './tools'
import { command, deck, lastState, newWorld, NOW, step, work, world, type World } from './world'

/**
 * Claude's questions (AskUserQuestion) and permission prompts on the web
 * deck. A question is raced: its dialog is held open beneath the deck (the
 * test's own hook, standing for Claude Code) while the page may answer it.
 * The deck answering first abandons the dialog and returns the deck's
 * answers; Claude Code answering first (or its idle timer) stands, and a
 * late answer from the page is refused. A permission prompt is shown only
 * once its dialog shows, and taken down when its call ends or is refused.
 */

const QUESTION = 'Which library should we use for dates?'
const QUESTIONS = [
  {
    question: QUESTION,
    header: 'Library',
    multiSelect: false,
    options: [
      { label: 'date-fns', description: 'Small and modular' },
      { label: 'Luxon', description: 'Time zones built in' },
    ],
  },
]
const FEATURES = {
  question: 'Which checks should run?',
  header: 'Checks',
  multiSelect: true,
  options: [
    { label: 'Lint', description: 'eslint' },
    { label: 'Types', description: 'tsc' },
    { label: 'Tests', description: 'node --test' },
  ],
}

/** An AskUserQuestion call of the Orchestrator's, `toolu_<n>`, left running: its dialog stays open beneath until settled or abandoned. */
function ask($: Engine, id: string, questions: readonly unknown[] = QUESTIONS) {
  return $.tool.call({ tool: 'AskUserQuestion', tool_use_id: id, questions } as never)
}

/** The talk between the Orchestrator and you about questions, as [from, to, kind, text]. */
function asked(w: World): [string, string, string, string][] {
  return lastState(w)
    .messages.filter(one => one.kind === 'question' || one.kind === 'choice')
    .map(one => [one.from, one.to, one.kind, one.text])
}

test('the deck answers first: the dialog beneath is abandoned, the call returns the deck`s answers with its own questions, and Talk and the ack say so', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  const call = ask($, 'toolu_q1')
  await clock.settle()
  await clock.advance(400)

  // held on you: the question itself, answerable; one dialog opened beneath, with the deck's line under it
  let state = lastState(w)
  expect(state.pending).toEqual([{ id: 'toolu_q1', agentId: 'main', kind: 'question', tool: 'AskUserQuestion', at: NOW, questions: QUESTIONS, isAnswerable: true }])
  expect(state.needs).toEqual({ tone: 'attention', kind: 'blocked', text: `Orchestrator asks: ${QUESTION}`, agentId: 'main' })
  expect(state.agents.find(one => one.id === 'main')).toMatchObject({ status: 'waiting', needsYou: `asks: ${QUESTION}`, now: `Asks: ${QUESTION}` })
  expect(state.activity[state.activity.length - 1]).toMatchObject({ agent: 'main', tool: 'AskUserQuestion', target: QUESTION, ok: null })
  expect(w.held.map(one => one.id)).toEqual(['toolu_q1'])
  expect(w.notices).toEqual([{ id: 'toolu_q1', text: 'Also answerable in Apiarius' }])
  expect(asked(w)).toEqual([['main', 'you', 'question', QUESTION]])

  // the page answers (a label in any case is the option's own)
  command(w.children[0], { cmd: 'answer', id: 'a1', callId: 'toolu_q1', answers: { [QUESTION]: 'luxon' } })
  await clock.settle()
  const ran = await call
  expect(ran).toMatchObject({ result: { questions: QUESTIONS, answers: { [QUESTION]: 'Luxon' } } })
  expect(w.held[0]?.isAborted).toBe(true)
  expect(w.held).toHaveLength(1)
  await clock.advance(400)

  state = lastState(w)
  expect(state.pending).toEqual([])
  expect(state.needs.kind).not.toBe('blocked')
  expect(asked(w)).toEqual([
    ['main', 'you', 'question', QUESTION],
    ['you', 'main', 'choice', 'You answered: Luxon'],
  ])
  expect(state.messages.filter(one => one.kind === 'question' || one.kind === 'choice').map(one => [one.callId, one.ackId])).toEqual([
    ['toolu_q1', undefined],
    ['toolu_q1', 'a1'],
  ])
  expect(state.acks).toEqual([{ id: 'a1', ok: true, status: 'answered', text: 'Claude carries on', at: NOW + 400 }])
  expect(state.activity[state.activity.length - 1]).toMatchObject({ tool: 'AskUserQuestion', ok: true })

  // the page answers again: too late
  command(w.children[0], { cmd: 'answer', id: 'a2', callId: 'toolu_q1', answers: { [QUESTION]: 'date-fns' } })
  await clock.settle()
  await clock.advance(400)
  expect(lastState(w).acks.find(one => one.id === 'a2')).toMatchObject({ ok: false, status: 'failed', text: 'No longer pending' })
})

test('Claude Code answers first: its answer stands, Talk says it was answered there, and a late answer from the page is refused', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  const call = ask($, 'toolu_q2')
  await clock.settle()
  const answered = { result: { questions: QUESTIONS, answers: { [QUESTION]: 'date-fns' } } }
  w.held[0]?.settle(answered)
  expect(await call).toMatchObject(answered)
  await clock.advance(400)
  expect(lastState(w).pending).toEqual([])
  expect(asked(w)).toEqual([
    ['main', 'you', 'question', QUESTION],
    ['you', 'main', 'choice', 'Answered in Claude Code: date-fns'],
  ])
  command(w.children[0], { cmd: 'answer', id: 'a3', callId: 'toolu_q2', answers: { [QUESTION]: 'Luxon' } })
  await clock.settle()
  await clock.advance(400)
  expect(lastState(w).acks).toEqual([{ id: 'a3', ok: false, status: 'failed', text: 'Already answered in Claude Code', at: NOW + 400 }])
})

test('the dialog answers itself after you were idle (afkTimeoutMs): Talk says so, and a late answer from the page is told the same', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  const call = ask($, 'toolu_q3')
  await clock.settle()
  w.held[0]?.settle({ result: { questions: QUESTIONS, answers: { [QUESTION]: 'date-fns' }, afkTimeoutMs: 60_000 } })
  await call
  command(w.children[0], { cmd: 'answer', id: 'a4', callId: 'toolu_q3', answers: { [QUESTION]: 'Luxon' } })
  await clock.settle()
  await clock.advance(400)
  expect(asked(w)).toEqual([
    ['main', 'you', 'question', QUESTION],
    ['you', 'main', 'choice', 'Auto-answered after idle: date-fns'],
  ])
  expect(lastState(w).acks).toEqual([{ id: 'a4', ok: false, status: 'failed', text: 'Auto-answered after idle', at: NOW }])
})

test('a stale or invalid answer is refused and the race goes on: a call never asked, a question the call did not ask; then several questions, a multi-select`s labels and words of your own answer it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  const call = ask($, 'toolu_q4', [...QUESTIONS, FEATURES])
  await clock.settle()
  await clock.advance(400)
  expect(lastState(w).needs.text).toBe('Orchestrator asks 2 questions')
  expect(asked(w)).toEqual([['main', 'you', 'question', `${QUESTION}\n\nWhich checks should run?`]])

  const child = w.children[0]
  command(child, { cmd: 'answer', id: 'b1', callId: 'toolu_never', answers: { [QUESTION]: 'Luxon' } })
  command(child, { cmd: 'answer', id: 'b2', callId: 'toolu_q4', answers: { 'Which database?': 'Postgres' } })
  command(child, { cmd: 'answer', id: 'b3', callId: 'toolu_q4', answers: {} })
  await clock.settle()
  await clock.advance(400)
  expect(lastState(w).acks.map(one => [one.id, one.text])).toEqual([
    ['b1', 'No longer pending'],
    ['b2', 'Not a question it asked: Which database?'],
    ['b3', 'Not an answer the deck can read'],
  ])
  expect(lastState(w).pending.map(one => [one.id, one.isAnswerable])).toEqual([['toolu_q4', true]])
  expect(w.held[0]?.isAborted).toBe(false)

  // words of your own for the first (its Other), two labels for the second: the labels joined as the dialog joins them
  command(child, { cmd: 'answer', id: 'b4', callId: 'toolu_q4', answers: { [QUESTION]: 'Temporal, once it ships', 'Which checks should run?': 'lint,tests' } })
  await clock.settle()
  expect(await call).toMatchObject({ result: { answers: { [QUESTION]: 'Temporal, once it ships', 'Which checks should run?': 'Lint, Tests' } } })
  await clock.advance(400)
  expect(asked(w)[1]).toEqual(['you', 'main', 'choice', 'You answered: Library: Temporal, once it ships · Checks: Lint, Tests'])
  expect(lastState(w).acks.find(one => one.id === 'b4')).toMatchObject({ status: 'answered' })
})

test('after a reload a question restored from the snapshot is shown, not answerable from the page; it goes once its agent moves on', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  const data = M.emptyData(NOW - 60_000)
  const main = M.agentOf(data, M.MAIN)
  if (main) main.status = 'running'
  M.notePending(data, { id: 'toolu_q9', agentId: M.MAIN, kind: 'question', tool: 'AskUserQuestion', at: NOW - 5_000, questions: QUESTIONS })
  world(on, w, { v: M.SNAPSHOT_VERSION, data, view: M.defaultView() })
  // the reloaded module starts, and the web deck with it: the dialog is still open, so no turn starts
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('web'))
  await clock.advance(400)
  expect(lastState(w).pending).toEqual([{ id: 'toolu_q9', agentId: 'main', kind: 'question', tool: 'AskUserQuestion', at: NOW - 5_000, questions: QUESTIONS, isAnswerable: false }])
  expect(lastState(w).needs.text).toBe(`Orchestrator asks: ${QUESTION}`)

  command(w.children[0], { cmd: 'answer', id: 'c1', callId: 'toolu_q9', answers: { [QUESTION]: 'Luxon' } })
  await clock.settle()
  await clock.advance(400)
  expect(lastState(w).acks).toEqual([{ id: 'c1', ok: false, status: 'failed', text: 'The deck cannot answer this one since it reloaded: answer it in Claude Code', at: NOW + 400 }])

  // a subagent's step changes nothing of the Orchestrator's; its own next step does: the question was answered meanwhile
  await step($, 'agent-x1', 0)
  await clock.advance(400)
  expect(lastState(w).pending.map(one => one.id)).toEqual(['toolu_q9'])
  await step($, undefined, 1)
  await clock.advance(400)
  expect(lastState(w).pending).toEqual([])
})

test('a permission prompt is held on you only once its dialog shows (a tool.check ask, then the matching PermissionRequest): the page sees its command, until the call ends', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld({ holding: ['Bash', 'Edit', 'WebFetch'] })
  world(on, w)
  await work($)
  const input = { command: 'npm test -- --watch=false', description: 'Run the unit tests' }
  const call = $.tool.call(bash({ tool_use_id: 'toolu_b1', ...input, agentId: 'agent-x1' }))
  await clock.settle()
  // the engine asks the mode's decider: no dialog yet (the auto-mode classifier and a headless host get the same ask)
  await $.tool.check({ tool: 'Bash', input, tool_use_id: 'toolu_b1', agentId: 'agent-x1' })
  await clock.advance(400)
  expect(lastState(w).pending).toEqual([])

  // the dialog shows: its input matched whatever its keys' order
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { description: input.description, command: input.command }, agent_id: 'agent-x1' })
  await clock.advance(400)
  let state = lastState(w)
  expect(state.pending).toEqual([{ id: 'toolu_b1', agentId: 'agent-x1', kind: 'permission', tool: 'Bash', at: NOW + 400, command: input.command, description: 'Run the unit tests', isAnswerable: false }])
  expect(state.needs).toEqual({ tone: 'attention', kind: 'blocked', text: 'scout needs your OK to run `npm test -- --watch=false`', agentId: 'agent-x1' })
  expect(state.agents.find(one => one.id === 'agent-x1')).toMatchObject({ status: 'waiting', needsYou: 'needs your OK to run `npm test -- --watch=false`', now: 'Needs your OK to run `npm test -- --watch=false`' })

  // you allow it in Claude Code: the call runs and ends
  w.held[0]?.settle({ result: { stdout: 'ok', stderr: '', interrupted: false } })
  await call
  await clock.advance(400)
  state = lastState(w)
  expect(state.pending).toEqual([])
  expect(state.agents.find(one => one.id === 'agent-x1')?.status).toBe('running')
})

test('no permission prompt is held without a dialog: an ask no dialog follows, a dialog a settings hook decided, a question or a plan (their dialogs are your say), a query with no call; one refused is taken down', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld({ holding: ['Edit', 'ExitPlanMode', 'WebFetch'] })
  world(on, w)
  await work($)

  // a settings hook decides the dialog itself
  w.isDecided = true
  const edit = { file_path: '/work/src/range.js', old_string: 'a', new_string: 'b' }
  void $.tool.call({ tool: 'Edit', tool_use_id: 'toolu_e1', ...edit } as never)
  await clock.settle()
  await $.tool.check({ tool: 'Edit', input: edit, tool_use_id: 'toolu_e1' })
  await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: edit })
  w.isDecided = false
  // ExitPlanMode's dialog is the plan's approval; a query (no call) is no prompt at all
  void $.tool.call({ tool: 'ExitPlanMode', tool_use_id: 'toolu_p1' } as never)
  await clock.settle()
  await $.tool.check({ tool: 'ExitPlanMode', input: {}, tool_use_id: 'toolu_p1' })
  await $.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: {} })
  await $.tool.check({ tool: 'WebFetch', input: { url: 'https://example.com' } })
  await $.classic.PermissionRequest({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } })
  await clock.advance(400)
  expect(lastState(w).pending).toEqual([])

  // a WebFetch whose dialog shows, then the auto-mode classifier refuses it
  void $.tool.call({ tool: 'WebFetch', tool_use_id: 'toolu_w1', url: 'https://example.com/docs', prompt: 'Read it' } as never)
  await clock.settle()
  await $.tool.check({ tool: 'WebFetch', input: { url: 'https://example.com/docs', prompt: 'Read it' }, tool_use_id: 'toolu_w1' })
  await $.classic.PermissionRequest({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com/docs', prompt: 'Read it' } })
  await clock.advance(400)
  expect(lastState(w).pending).toMatchObject([{ id: 'toolu_w1', kind: 'permission', tool: 'WebFetch', description: 'example.com/docs' }])
  expect(lastState(w).needs.text).toBe('Orchestrator needs your OK to use WebFetch')
  await $.classic.PermissionDenied({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com/docs', prompt: 'Read it' }, tool_use_id: 'toolu_w1', reason: 'denied by the classifier' })
  await clock.advance(400)
  expect(lastState(w).pending).toEqual([])
  for (const held of w.held) held.settle({ deny: 'the test is over' })
})

test('a question`s notification no longer reads "allow AskUserQuestion": the needs-you line says what it asks, and a call`s target is never the event`s own fields', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  void ask($, 'toolu_q5')
  await clock.settle()
  await $.classic.Notification({ message: 'Claude needs your permission to use AskUserQuestion', notification_type: 'permission_prompt' })
  await clock.advance(400)
  const state = lastState(w)
  expect(state.needs.text).toBe(`Orchestrator asks: ${QUESTION}`)
  expect(JSON.stringify(state)).not.toContain('allow AskUserQuestion')
  for (const held of w.held) held.settle({ deny: 'the test is over' })

  // the notification alone (a reload lost the question): it still says what the call asks
  const data = M.emptyData(NOW)
  const main = M.agentOf(data, M.MAIN)!
  M.beginTool(data, main, M.activityOf('toolu_q6', 'AskUserQuestion', { tool: 'AskUserQuestion', tool_use_id: 'toolu_q6', questions: QUESTIONS }, null, NOW))
  M.noteNeeds(data, { kind: 'permission_prompt', text: 'Claude needs your permission to use AskUserQuestion', at: NOW })
  expect(M.needsOf(data, { isRepo: false, files: [] }).text).toBe(`Orchestrator asks: ${QUESTION}`)
  M.endTool(main, 'toolu_q6', true, NOW)
  delete main.needs
  M.noteNeeds(data, { kind: 'permission_prompt', text: 'Claude needs your permission to use AskUserQuestion', at: NOW })
  expect(M.needsOf(data, { isRepo: false, files: [] }).text).toBe('Orchestrator asks you a question')

  // targets: the first question; for any other tool the call's own words, never its name, id or loop
  expect(M.targetOf('AskUserQuestion', { tool: 'AskUserQuestion', tool_use_id: 'toolu_1', questions: QUESTIONS }, null)).toBe(QUESTION)
  expect(M.targetOf('CronCreate', { tool: 'CronCreate', tool_use_id: 'toolu_2', agentId: 'agent-x1', cron: '*/5 * * * *', prompt: 'check' }, null)).toBe('*/5 * * * *')
  expect(M.targetOf('EnterPlanMode', { tool: 'EnterPlanMode', tool_use_id: 'toolu_3' }, null)).toBe('')
})

test('what waits on you, in words: a question, several, a shell command, a file, any other tool; the Notification fallback the same way', () => {
  expect(M.questionPhraseOf(QUESTIONS)).toBe(`asks: ${QUESTION}`)
  expect(M.questionPhraseOf([...QUESTIONS, FEATURES, FEATURES])).toBe('asks 3 questions')
  expect(M.permissionPhraseOf('Bash', 'npm test')).toBe('needs your OK to run `npm test`')
  expect(M.permissionPhraseOf('Edit', undefined, 'src/a.ts')).toBe('needs your OK to edit `src/a.ts`')
  expect(M.permissionPhraseOf('Write', undefined, 'src/new.ts')).toBe('needs your OK to write `src/new.ts`')
  expect(M.permissionPhraseOf('WebFetch')).toBe('needs your OK to use WebFetch')
  expect(M.permissionPhraseOf('mcp__github__create_issue')).toBe('needs your OK to use github / create_issue')
  expect(M.waitLineOf('needs your OK to run `npm test`')).toBe('Needs your OK to run `npm test`')
  expect(M.waitLineOf('')).toBe('')

  // a held permission prompt, from its call's input: the command whole, else the file (repository-relative), and what it says it does
  const bash: DeckPending = M.permissionOf({ id: 't1', tool: 'Bash', input: { command: 'npm test\n  --watch=false', description: 'Run the tests' }, agentId: 'main', at: NOW }, '/repo')
  expect(bash).toEqual({ id: 't1', agentId: 'main', kind: 'permission', tool: 'Bash', at: NOW, command: 'npm test\n  --watch=false', description: 'Run the tests' })
  expect(M.pendingPhraseOf(bash)).toBe('needs your OK to run `npm test --watch=false`')
  const edit = M.permissionOf({ id: 't2', tool: 'Edit', input: { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' }, agentId: 'main', at: NOW }, '/repo')
  expect(edit).toEqual({ id: 't2', agentId: 'main', kind: 'permission', tool: 'Edit', at: NOW, path: 'src/a.ts' })
  expect(M.pendingPhraseOf(edit)).toBe('needs your OK to edit `src/a.ts`')
  expect(M.permissionOf({ id: 't3', tool: 'mcp__github__create_issue', input: { title: 'Bug' }, agentId: 'main', at: NOW }, null)).toEqual({ id: 't3', agentId: 'main', kind: 'permission', tool: 'mcp__github__create_issue', at: NOW })

  // the fallback: a notification of a permission prompt, worded from its call
  const data = M.emptyData(NOW)
  const main = M.agentOf(data, M.MAIN)!
  M.beginTool(data, main, M.activityOf('t4', 'Read', { file_path: '/repo/.env' }, '/repo', NOW))
  M.noteNeeds(data, { kind: 'permission_prompt', text: 'Claude needs your permission to use Read', at: NOW })
  expect(M.needsOf(data, { isRepo: false, files: [] }).text).toBe('Orchestrator needs your OK to read `.env`')
  delete main.needs
  M.noteNeeds(data, { kind: 'elicitation_dialog', text: 'The github server asks for a token', at: NOW })
  expect(M.needsOf(data, { isRepo: false, files: [] }).text).toBe('Orchestrator waits on you: The github server asks for a token')
})

test('an answer`s checks, pure: its shape (the call, one to four answers, none blank or too long), the question still held, its questions; labels as the options spell them', () => {
  const data = M.emptyData(NOW)
  const route = (cmd: Record<string, unknown>) => W.routeOf(cmd, data)
  // read before the text check: an answer carries no text
  expect(route({ cmd: 'answer', callId: ' toolu_q ', answers: { [QUESTION]: ' Luxon ', other: '  ' } })).toEqual({ kind: 'answer', callId: 'toolu_q', answers: { [QUESTION]: 'Luxon' } })
  for (const bad of [
    { cmd: 'answer', answers: { [QUESTION]: 'Luxon' } },
    { cmd: 'answer', callId: '', answers: { [QUESTION]: 'Luxon' } },
    { cmd: 'answer', callId: 'toolu_q', answers: {} },
    { cmd: 'answer', callId: 'toolu_q', answers: { a: '  ' } },
    { cmd: 'answer', callId: 'toolu_q', answers: { a: 'x', b: 'x', c: 'x', d: 'x', e: 'x' } },
    { cmd: 'answer', callId: 'toolu_q', answers: { a: 'x'.repeat(2001) } },
    { cmd: 'answer', callId: 'toolu_q', answers: ['Luxon'] },
  ]) {
    expect(route(bad)).toBeNull()
  }
  expect(W.cmdIdOf({ cmd: 'ping', id: 'abc_DEF-123' })).toBe('abc_DEF-123')
  for (const id of ['', 'a b', 'x'.repeat(41), 7, 'é']) expect(W.cmdIdOf({ cmd: 'ping', id })).toBe('')

  const item: DeckPending = { id: 'toolu_q', agentId: 'main', kind: 'question', tool: 'AskUserQuestion', at: NOW, questions: [...QUESTIONS, FEATURES] }
  expect(W.answerProblemOf(item, { [QUESTION]: 'Luxon' })).toBe('')
  expect(W.answerProblemOf(undefined, { [QUESTION]: 'Luxon' })).toBe('No longer pending')
  expect(W.answerProblemOf({ ...item, kind: 'permission' }, { [QUESTION]: 'Luxon' })).toBe('No longer pending')
  expect(W.answerProblemOf(item, { 'Which one?': 'A' })).toBe('Not a question it asked: Which one?')
  expect(W.answersFor(item, { [QUESTION]: 'LUXON', 'Which checks should run?': 'types, lint' })).toEqual({ [QUESTION]: 'Luxon', 'Which checks should run?': 'Types, Lint' })
  expect(W.answersFor(item, { 'Which checks should run?': 'lint, and a smoke test' })).toEqual({ 'Which checks should run?': 'lint, and a smoke test' })
  expect(M.answeredOf(item.questions ?? [], { 'Which checks should run?': 'Lint' })).toBe('Checks: Lint')
  expect(M.answeredOf(QUESTIONS, {})).toBe('')
})
