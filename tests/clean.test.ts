import { expect, mock, test } from 'claude-code/testing'

import * as M from '../hooks/model'
import { deck, lastState, newWorld, NOW, world } from './world'

/**
 * Your prompt as people read it (`M.cleanPrompt`): the Desktop app's pasted
 * blocks as "[pasted text]" marks with your words around them, no reminder,
 * and no local command's echo taken for a goal; in the goal's headline and
 * text, its follow-ups, and your prompts in the Orchestrator's Talk, live,
 * restored from a snapshot, or recovered from the transcript.
 */

/** A paste as the Desktop app wraps it in a prompt: its id on both tags, the text on lines of its own. */
function pasted(id: string, body: string): string {
  return `<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">`
}

/** Five lines of the web deck's activity, pasted. */
const BLOB = ['Bash', "Record the native deck's state and lessons in project notes", '926ms', '10m', 'SendMessage'].join('\n')

/** What Claude Code records for a local command (`/apiarius web`), as a transcript holds it. */
const CAVEAT = "<local-command-caveat>The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user. It's recorded here as context for later messages.</local-command-caveat>"
const ECHO = '<command-name>/apiarius</command-name>\n            <command-message>apiarius</command-message>\n            <command-args>web</command-args>'
const STDOUT = '<local-command-stdout>Dashboard at http://127.0.0.1:54800/?t=x</local-command-stdout>'
const REMINDER = "<system-reminder>\nThe task tools haven't been used recently.\n</system-reminder>"

/** The prompt of the screenshot: your words, a paste of five lines, more words. */
const PROMPT = `the activity in the browser is much nicer to look at because it has \n\n${pasted('3c84', BLOB)}\n\nand the talk in the browser is much ncier too!!`
const PROMPT_WORDS = 'the activity in the browser is much nicer to look at because it has\n\n[pasted text, 5 lines]\n\nand the talk in the browser is much ncier too!!'

test('cleanPrompt: a paste is "[pasted text]", or "[pasted text, n lines]" past one line, your words around it kept; reminders go; a local command`s echo alone leaves nothing', () => {
  expect(M.cleanPrompt(PROMPT)).toBe(PROMPT_WORDS)
  // inline, one line, no id
  expect(M.cleanPrompt('compare <pasted_content>v1.2.3</pasted_content> with mine')).toBe('compare [pasted text] with mine')
  // two pastes: the blank lines at a paste's ends are not counted
  expect(M.cleanPrompt(`${pasted('a1', '\none\ntwo\n')}\n${pasted('b2', 'three')}\nwhich one?`)).toBe('[pasted text, 2 lines]\n[pasted text]\nwhich one?')
  // a paste that holds another block's end runs to the end with its own id; one never ended runs to the end of the text
  expect(M.cleanPrompt(`see ${pasted('3c84', 'a\n</pasted_content>\nb')} ok`)).toBe('see [pasted text, 3 lines] ok')
  expect(M.cleanPrompt('look: <pasted_content id="9f">\nx\ny')).toBe('look: [pasted text, 2 lines]')
  // reminders go: before your words, between them, after them
  expect(M.cleanPrompt(`${REMINDER}\nFix the login bug`)).toBe('Fix the login bug')
  expect(M.cleanPrompt('Fix <system-reminder>The IDE has src/a.ts open.</system-reminder> it')).toBe('Fix it')
  expect(M.cleanPrompt(`Fix it\r\n\r\n${REMINDER}`)).toBe('Fix it')
  // a local command's echo, or a reminder, alone: none of your words
  for (const echo of [CAVEAT, ECHO, `${CAVEAT}\n${ECHO}`, STDOUT, `${ECHO}\n${STDOUT}`, `${CAVEAT} ${ECHO}`, REMINDER, '<bash-input>git status</bash-input>', '  \n ']) {
    expect(M.cleanPrompt(echo), echo).toBe('')
  }
  // your words beside one stay
  expect(M.cleanPrompt(`${CAVEAT}\n${ECHO}\n\n\nnow fix it`)).toBe('now fix it')
  // words with none of these come back as they were, trimmed
  expect(M.cleanPrompt('  Fix the login bug\n\n\n  - keep the old tokens  \n')).toBe('Fix the login bug\n\n\n  - keep the old tokens')
  expect(M.cleanPrompt('why does <Box> wrap here? [Image #1]')).toBe('why does <Box> wrap here? [Image #1]')
})

test('the goal reads as you wrote it: its headline and text, each follow-up, a slash command`s headline; a local command`s echo starts no goal and follows none up', () => {
  const data = M.emptyData(NOW)
  const first = `for the orchestrator i get\n\n${pasted('3c84', 'You\nnow\nYO\ngive me a 3 option prompt\nQueued: Claude reads it now')}\n`
  expect(M.promptKindOf(data, { origin: { kind: 'composer' }, text: first })).toBe('goal')
  M.noteGoal(data, 'goal', { text: first, origin: 'composer', at: NOW })
  expect(M.goalOf(data)).toMatchObject({ headline: 'for the orchestrator i get', text: 'for the orchestrator i get\n\n[pasted text, 5 lines]' })

  // the Orchestrator at work: your words follow the goal up, on one line
  M.agentOf(data, M.MAIN)!.status = 'running'
  const more = `${REMINDER}\nand this one\n${pasted('77aa', 'Not delivered: no verdict')}`
  expect(M.promptKindOf(data, { origin: { kind: 'composer' }, text: more })).toBe('followUp')
  M.noteGoal(data, 'followUp', { text: more, origin: 'composer', at: NOW + 1 })
  // an echo, or a reminder alone: no follow-up, and no goal even with a new one asked for
  M.armNewGoal(data)
  for (const echo of [`${CAVEAT}\n${ECHO}`, `${ECHO}\n${STDOUT}`, REMINDER]) {
    expect(M.promptKindOf(data, { origin: { kind: 'composer' }, text: echo }), echo).toBe('event')
    expect(M.noteGoal(data, 'followUp', { text: echo, origin: 'composer', at: NOW + 2 })).toBeUndefined()
    expect(M.noteGoal(data, 'goal', { text: echo, origin: 'composer', at: NOW + 2 })).toBeUndefined()
  }
  expect(data.goals).toHaveLength(1)
  expect(M.goalOf(data)?.followUps).toEqual([{ text: 'and this one [pasted text]', at: NOW + 1 }])

  // a slash command's headline, given or set after, as you wrote it
  M.noteGoal(data, 'goal', { text: 'Review the changes for bugs.', headline: `/review ${pasted('c1', 'src/a.ts')}`, origin: 'composer', at: NOW + 3 })
  expect(M.goalOf(data)?.headline).toBe('/review [pasted text]')
  expect(M.retitleGoal(data, `/review ${pasted('c2', 'src/a.ts\nsrc/b.ts')}`, NOW)).toBe(true)
  expect(M.goalOf(data)?.headline).toBe('/review [pasted text, 2 lines]')
})

test('your prompts in the Orchestrator`s Talk read as you wrote them; an echo alone is not logged; others` words stay as they came', () => {
  const data = M.emptyData(NOW)
  const said = M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: `this is what i get\n\n${pasted('3c84', 'You\nnow\nhi')}\n${REMINDER}`, at: NOW })
  expect(said.text).toBe('this is what i get\n\n[pasted text, 3 lines]')
  const echo = M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: `${CAVEAT}\n${ECHO}`, at: NOW + 1 })
  expect(echo.text).toBe('')
  expect(data.messages.map(one => one.text)).toEqual(['this is what i get\n\n[pasted text, 3 lines]'])
  // a brief that quotes the tags is the Orchestrator's words, kept as they are
  M.addMessage(data, { from: M.MAIN, to: 'a1', kind: 'spawn', text: 'Wrap it in <pasted_content id="1">…</pasted_content id="1">', at: NOW + 2 })
  expect(data.messages[1]?.text).toBe('Wrap it in <pasted_content id="1">…</pasted_content id="1">')
})

test('through the hooks: the prompt you submit is the goal, the Orchestrator`s task and your Talk as you wrote it, in the state the page and the pane read; a local command`s echo is none of them', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: PROMPT, origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text: PROMPT, turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'Looking.', durationMs: 1000, isAborted: false, reason: 'answer' })
  // idle with nothing live, an echo would have been the next goal
  const echo = `${CAVEAT}\n${ECHO}`
  await $.prompt.submit({ text: echo, origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text: echo, turnId: 't2' })
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 100, isAborted: false, reason: 'answer' })
  await $.command.run(deck('web'))
  await clock.advance(400)

  const state = lastState(w)
  expect(state.goal).toMatchObject({ headline: 'the activity in the browser is much nicer to look at because it has', text: PROMPT_WORDS, followUps: [] })
  expect(state.agents.find(one => one.id === M.MAIN)?.task).toBe(PROMPT_WORDS)
  expect(state.messages.filter(one => one.from === M.YOU).map(one => [one.kind, one.text])).toEqual([['prompt', PROMPT_WORDS]])
  expect(JSON.stringify(state)).not.toMatch(/pasted_content|command-name|local-command-caveat|system-reminder/)
})

test('restored: a snapshot an earlier build kept with the tags reads as you wrote it (the goal, its follow-ups, your prompts in Talk), an echo kept as a prompt is the command you ran, and words with no tags stay exactly', () => {
  const raw = M.emptyData(NOW)
  raw.goals = [
    {
      id: 'g1',
      headline: '<pasted_content id="3c84">',
      text: `${pasted('3c84', 'a\nb')}\nfix this`,
      at: NOW,
      followUps: [
        { text: 'and <pasted_content id="9">x</pasted_content id="9"> too', at: NOW + 1 },
        { text: `${CAVEAT} ${ECHO}`, at: NOW + 2 },
      ],
      origin: 'composer',
    },
  ]
  raw.messages = [
    { id: 'm1', from: M.YOU, to: M.MAIN, kind: 'prompt', text: `fix this\n${pasted('3c84', 'a\nb')}`, at: NOW },
    { id: 'm2', from: M.YOU, to: M.MAIN, kind: 'prompt', text: ECHO, at: NOW + 1 },
    { id: 'm3', from: M.MAIN, to: M.YOU, kind: 'answer', text: 'Kept <pasted_content> as it came', at: NOW + 2 },
  ]
  const data = M.healData(M.copyOf(raw), NOW)
  expect(data.goals[0]).toMatchObject({ headline: '[pasted text, 2 lines]', text: '[pasted text, 2 lines]\nfix this', followUps: [{ text: 'and [pasted text] too', at: NOW + 1 }] })
  expect(data.messages.map(one => [one.id, one.kind, one.to, one.text])).toEqual([
    ['m1', 'prompt', M.MAIN, 'fix this\n[pasted text, 2 lines]'],
    ['m2', 'command', '', '/apiarius web'],
    ['m3', 'answer', M.YOU, 'Kept <pasted_content> as it came'],
  ])

  const plain = M.emptyData(NOW)
  M.noteGoal(plain, 'goal', { text: 'Fix the login bug', headline: '/fix login', origin: 'composer', at: NOW })
  M.noteGoal(plain, 'followUp', { text: 'and the docs', origin: 'composer', at: NOW + 1 })
  M.addMessage(plain, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: 'Fix the login bug', at: NOW })
  const healed = M.healData(M.copyOf(plain), NOW)
  expect(healed.goals).toEqual(plain.goals)
  expect(healed.messages).toEqual(plain.messages)
})

test('a slash command run alone is the command you ran, no words of yours: no goal, a `command` row to nobody ("/login"), never a prompt; a command with words of yours around it stays your prompt', () => {
  expect(M.commandLineOf('/login')).toBe('/login')
  expect(M.commandLineOf('  /plugin:skill \n')).toBe('/plugin:skill')
  expect(M.commandLineOf(`${CAVEAT}\n${ECHO}`)).toBe('/apiarius web')
  expect(M.commandLineOf(`${ECHO}\n${STDOUT}`)).toBe('/apiarius web')
  for (const words of ['/review the diff', '/tmp/out.txt is empty', 'please /login again', 'login', REMINDER, '']) expect(M.commandLineOf(words), words).toBe('')
  expect(M.commandOf({ name: 'review', args: ' the \n diff ' })).toBe('/review the diff')
  expect(M.commandOf({ name: 'login', args: '' })).toBe('/login')

  const data = M.emptyData(NOW)
  expect(M.promptKindOf(data, { origin: { kind: 'composer' }, text: '/login' })).toBe('event')
  expect(M.promptKindOf(data, { origin: { kind: 'composer' }, text: '/review the diff' })).toBe('goal')
  M.addPrompt(data, { text: '/login', at: NOW })
  M.addPrompt(data, { text: `${CAVEAT}\n${ECHO}`, at: NOW + 1 })
  // the engine says the prompt runs a command: whatever its words, the command as typed
  M.addPrompt(data, { text: 'Review the changes for bugs.', at: NOW + 2, command: '/review the diff' })
  M.addPrompt(data, { text: 'fix the /login page', at: NOW + 3 })
  expect(data.messages.map(one => [one.from, one.to, one.kind, one.text])).toEqual([
    [M.YOU, '', 'command', '/login'],
    [M.YOU, '', 'command', '/apiarius web'],
    [M.YOU, '', 'command', '/review the diff'],
    [M.YOU, M.MAIN, 'prompt', 'fix the /login page'],
  ])
})

test('recovered: the transcript`s newest prompt reads as a live goal does, and a reminder beside your words leaves them yours', () => {
  const user = (text: string) => ({ role: 'user', text })
  expect(M.recoverGoal([user(PROMPT), user(`${CAVEAT}\n${ECHO}`), user(REMINDER)])).toEqual({ text: PROMPT_WORDS, headline: 'the activity in the browser is much nicer to look at because it has' })
  expect(M.recoverGoal([user('Fix it'), user(`${REMINDER}\nAnd the docs`)])?.text).toBe('And the docs')
})
