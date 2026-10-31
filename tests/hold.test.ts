import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as H from '../hooks/hold'
import * as W from '../hooks/web'
import { command, deck, lastState, newWorld, NOW, PORT, work, world, type World } from './world'

/**
 * The web page's words in your voice, held for your Send (hooks/hold.ts).
 * The page in the Desktop's Browser pane has a `pane` link, and Claude's
 * tools can drive that pane: what it sends as you (a message, Review, an
 * answer, any of these for another session) waits in the band above the
 * prompt until you press its Send there, and nothing of it reaches the
 * model before. Your own browser's page (`full`) runs at once, as ever, and
 * what speaks for nobody runs at once from either.
 */

const BAND = { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const SURFACES = ['desktop', 'terminal'] as const

/** The band above the prompt on `surface`. */
function band($: Engine, surface: 'desktop' | 'terminal' = 'desktop') {
  return $.ui.mount({ plugin: 'apiarius', surface, component: 'AbovePrompt', props: BAND })
}

/** What the deck submitted to the Orchestrator as your words (`$.prompt.submit` asUser), in order. */
function spoken(w: World): string[] {
  return w.submitted.filter(one => (one.origin as { kind?: string } | undefined)?.kind === 'plugin').map(one => one.text)
}

/** The ack the page reads for command `id`. */
function ackOf(w: World, id: string) {
  return lastState(w).acks.find(one => one.id === id)
}

test('the Browser pane`s page: a message to the Orchestrator, one to an agent and Review wait in the band for your Send, and nothing of them reaches Claude before it; Send runs each as your own browser`s page would have, Discard drops one', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  const child = w.children[0]
  command(child, { cmd: 'chat', id: 'c-1', agentId: 'main', text: 'fix the flaky test' }, 'pane')
  command(child, { cmd: 'chat', id: 'c-2', agentId: 'agent-x1', text: 'look in src/range.js first' }, 'pane')
  command(child, { cmd: 'review', id: 'r-1', text: 'Review the uncommitted changes' }, 'pane')
  await clock.settle()
  await clock.advance(400)

  // held: no prompt submitted, nothing sent, nothing in the prompt box; the page's acks say where to press
  expect(spoken(w)).toEqual([])
  expect(w.sent).toEqual([])
  expect(w.filled).toEqual([])
  for (const id of ['c-1', 'c-2', 'r-1']) expect(ackOf(w, id)).toMatchObject({ ok: true, status: 'held', text: H.HELD_TEXT })
  // nothing of them in the state the page and the model's pane read but the acks
  expect(JSON.stringify(lastState(w).messages)).not.toContain('fix the flaky test')

  // the band: a row each, who sent it, to whom, its words, Send and Discard
  for (const surface of SURFACES) {
    const ui = await band($, surface)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('Web page')
    for (const words of ['→ Orchestrator: ', '“fix the flaky test”', '→ scout: ', '“look in src/range.js first”', 'asks for a review: ', '“Review the uncommitted changes”']) expect(drawn).toContain(words)
    expect((await ui.find({ key: 'held:send:h1' }))?.props).toMatchObject({ label: 'Send', variant: 'primary', autoFocus: true })
    expect((await ui.find({ key: 'held:send:h2' }))?.props.autoFocus).toBeUndefined()
    // no hotkey: a bare digit in an empty prompt would press a band Button
    for (const key of ['held:send:h1', 'held:discard:h1']) expect((await ui.find({ key }))?.props.hotkey).toBeUndefined()
    expect(drawn.includes('ctrl+x tab, then Enter, sends the first')).toBe(surface === 'terminal')
    await ui.unmount()
  }

  // your Send: the message goes as your next prompt, exactly as from your own browser; the one to scout goes to scout
  const ui = await band($)
  await ui.press({ key: 'held:send:h1' })
  await ui.redraw()
  await ui.press({ key: 'held:send:h2' })
  await ui.redraw()
  await clock.settle()
  expect(spoken(w)).toEqual(['fix the flaky test'])
  expect(w.sent).toEqual([{ to: 'agent-x1', text: 'look in src/range.js first' }])
  // Discard: Review is never asked for
  await ui.press({ key: 'held:discard:h3' })
  await clock.advance(400)
  expect(w.filled).toEqual([])
  expect(spoken(w)).toEqual(['fix the flaky test'])
  expect(ackOf(w, 'c-1')?.status).not.toBe('held')
  expect(ackOf(w, 'c-2')?.status).not.toBe('held')
  expect(ackOf(w, 'r-1')).toMatchObject({ ok: false, status: 'failed', text: 'Not sent: you discarded it above your prompt' })
  await ui.redraw()
  expect(await ui.find({ key: 'held:send:h1' })).toBeUndefined()
  // a second press of a Send that went does nothing more
  expect(JSON.stringify(await ui.drawn())).not.toContain('Web page')
  await ui.unmount()
})

test('your own browser`s page (a full link) runs your words at once; from either page what speaks for nobody runs at once (Clear finished, the avatar style); a line the server did not stamp full is held', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  const child = w.children[0]
  command(child, { cmd: 'chat', id: 'f-1', agentId: 'main', text: 'from my own browser' }, 'full')
  command(child, { cmd: 'avatarStyle', id: 'av-1', style: 'critter' }, 'pane')
  command(child, { cmd: 'clearFinished', id: 'cf-1' }, 'pane')
  await clock.settle()
  await clock.advance(400)
  expect(spoken(w)).toEqual(['from my own browser'])
  expect(ackOf(w, 'av-1')).toMatchObject({ status: 'delivered', text: 'Avatars: Critters' })
  expect(ackOf(w, 'cf-1')?.status).not.toBe('held')
  // no grade at all (an older server's line): as the Browser pane's
  child?.print(`${JSON.stringify({ cmd: 'chat', id: 'u-1', agentId: 'main', text: 'no grade' })}\n`)
  await clock.settle()
  await clock.advance(400)
  expect(spoken(w)).toEqual(['from my own browser'])
  expect(ackOf(w, 'u-1')).toMatchObject({ status: 'held' })
})

test('what waits goes unsent after ten minutes; at most five wait, the next refused; one refused now (no such agent) is refused at once, never held', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  const child = w.children[0]
  command(child, { cmd: 'chat', id: 'x-0', agentId: 'agent-nobody', text: 'hello?' }, 'pane')
  for (let i = 1; i <= 6; i++) command(child, { cmd: 'chat', id: `x-${i}`, agentId: 'main', text: `message ${i}` }, 'pane')
  await clock.settle()
  await clock.advance(400)
  expect(ackOf(w, 'x-0')).toMatchObject({ status: 'failed', text: 'No such agent in this session' })
  for (let i = 1; i <= 5; i++) expect(ackOf(w, `x-${i}`)?.status).toBe('held')
  expect(ackOf(w, 'x-6')).toMatchObject({ status: 'failed', text: H.FULL_TEXT })
  const ui = await band($)
  expect((await ui.findAll({ type: 'Button' })).filter(one => (one.key ?? '').startsWith('held:send:')).map(one => one.key)).toEqual(['held:send:h1', 'held:send:h2', 'held:send:h3', 'held:send:h4', 'held:send:h5'])
  await ui.unmount()
  // ten minutes on: each goes unsent, and says so
  await clock.advance(H.HOLD_MS + 3000)
  for (let i = 1; i <= 5; i++) expect(ackOf(w, `x-${i}`)).toMatchObject({ ok: false, status: 'failed', text: 'Not sent: it waited 10 minutes for your Send above the prompt' })
  expect(spoken(w)).toEqual([])
  const after = await band($)
  expect(JSON.stringify(await after.drawn())).not.toContain('Web page')
  await after.unmount()
})

test('the band shows what waits even while you hid it (/apiarius band), and only that then; a long one shows its start, More shows it whole', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  await $.command.run(deck('band'))
  let ui = await band($)
  // hidden, nothing waiting: the engine's own drawing
  expect(JSON.stringify(await ui.drawn())).not.toContain('1 working')
  await ui.unmount()
  const long = `Please ${'really '.repeat(30)}fix it`
  command(w.children[0], { cmd: 'chat', id: 'l-1', agentId: 'main', text: long }, 'pane')
  await clock.settle()
  await clock.advance(400)
  ui = await band($)
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Web page')
  // the band's own line stays hidden
  expect(drawn).not.toContain('1 working')
  expect(await ui.find({ key: 'band:open' })).toBeUndefined()
  expect((await ui.find({ key: 'held:more:h1' }))?.props).toMatchObject({ label: 'More', plain: true })
  await ui.press({ key: 'held:more:h1' })
  await ui.redraw()
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain(long)
  expect((await ui.find({ key: 'held:more:h1' }))?.props.label).toBe('Less')
  await ui.unmount()
})

test('an answer from the Browser pane`s page waits too: Send answers the question as the page would have at once; one for a question answered meanwhile in Claude Code goes with why', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  const QUESTION = 'Which library should we use for dates?'
  const QUESTIONS = [{ question: QUESTION, header: 'Library', multiSelect: false, options: [{ label: 'date-fns', description: 'Small' }, { label: 'Luxon', description: 'Zones' }] }]
  const call = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'toolu_q1', questions: QUESTIONS } as never)
  await clock.settle()
  await clock.advance(400)
  command(w.children[0], { cmd: 'answer', id: 'a-1', callId: 'toolu_q1', answers: { [QUESTION]: 'luxon' } }, 'pane')
  await clock.settle()
  await clock.advance(400)
  // the question still waits: its dialog open, the page's answer held
  expect(lastState(w).pending.map(one => one.id)).toEqual(['toolu_q1'])
  expect(ackOf(w, 'a-1')).toMatchObject({ status: 'held' })
  const ui = await band($)
  expect(JSON.stringify(await ui.drawn())).toContain('answers Orchestrator: ')
  expect(JSON.stringify(await ui.drawn())).toContain('“luxon”')
  await ui.press({ key: 'held:send:h1' })
  await clock.settle()
  expect(await call).toMatchObject({ result: { answers: { [QUESTION]: 'Luxon' } } })
  await clock.advance(400)
  expect(ackOf(w, 'a-1')).toMatchObject({ ok: true, status: 'answered' })
  await ui.unmount()

  // another question; the page's answer waits, and meanwhile Claude Code's own dialog answers it: the held one goes, saying why
  const second = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'toolu_q2', questions: QUESTIONS } as never)
  await clock.settle()
  await clock.advance(400)
  command(w.children[0], { cmd: 'answer', id: 'a-2', callId: 'toolu_q2', answers: { [QUESTION]: 'Luxon' } }, 'pane')
  await clock.settle()
  await clock.advance(400)
  expect(ackOf(w, 'a-2')).toMatchObject({ status: 'held' })
  const dialog = w.held.find(one => one.id === 'toolu_q2')
  dialog?.settle({ result: { questions: QUESTIONS, answers: { [QUESTION]: 'date-fns' } } })
  expect(await second).toMatchObject({ result: { answers: { [QUESTION]: 'date-fns' } } })
  await clock.advance(3000)
  expect(ackOf(w, 'a-2')).toMatchObject({ ok: false, status: 'failed', text: 'Already answered in Claude Code' })
  const after = await band($)
  expect(JSON.stringify(await after.drawn())).not.toContain('Web page')
  await after.unmount()
  // and one sent for it now is refused at once, never held
  command(w.children[0], { cmd: 'answer', id: 'a-3', callId: 'toolu_q2', answers: { [QUESTION]: 'Luxon' } }, 'pane')
  await clock.settle()
  await clock.advance(400)
  expect(ackOf(w, 'a-3')).toMatchObject({ ok: false, status: 'failed', text: 'Already answered in Claude Code' })
})

test('"Open in browser" opens a full link of its own, made for the press, with the system`s opener (web/open.js, the link on its stdin); the desktop shows no link, the terminal shows one to copy, made anew once its page traded it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  await $.command.run(deck('settings'))
  await clock.advance(500)
  const pane = (surface: 'desktop' | 'terminal') => ({ plugin: 'apiarius', surface, component: 'Pane' as const, requestId: 'apiarius', viewport: { columns: 120, rows: 60, isFullscreen: true }, props: { title: 'Apiarius', isFocused: true, bodyColumns: 116, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const })
  const desktop = await $.ui.mount(pane('desktop'))
  expect((await desktop.find({ key: 'settings:web:open-browser' }))?.props.label).toBe('Open in browser')
  // the desktop draws no link: a link it opens itself may land in the Browser pane
  expect(JSON.stringify(await desktop.drawn())).not.toContain(`http://127.0.0.1:${PORT}/`)
  await desktop.press({ key: 'settings:web:open-browser' })
  await desktop.press({ key: 'settings:web:open-browser' })
  await clock.settle()
  expect(w.browsed).toHaveLength(2)
  for (const link of w.browsed) expect(link).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${PORT}/\\?t=f-[0-9a-f]{16}-[0-9a-f]{32}\\n$`))
  // each press its own one-time link
  expect(w.browsed[0]).not.toBe(w.browsed[1])
  await desktop.unmount()

  const terminal = await $.ui.mount(pane('terminal'))
  const shown = (await terminal.find({ key: 'settings:web:link' }))?.text ?? ''
  expect(shown).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${PORT}/\\?t=f-[0-9a-f]{16}-[0-9a-f]{32}$`))
  // its page traded it: the terminal shows a new one
  const nonce = W.nonceOf(new URL(shown).searchParams.get('t') ?? '')
  w.children[0]?.print(`${JSON.stringify({ used: nonce, grade: 'full' })}\n`)
  await clock.settle()
  await terminal.redraw()
  const next = (await terminal.find({ key: 'settings:web:link' }))?.text ?? ''
  expect(next).toMatch(/\?t=f-/)
  expect(next).not.toBe(shown)
  await terminal.unmount()
  await clock.advance(400)
})

test('a ticket is sealed as web/server.js checks it: a known secret and nonce give the server test`s own ticket; the nonce reads back', () => {
  const secret = 'test-token-0123456789abcdef'
  expect(W.ticketOf(secret, 'pane', '0011223344556677')).toBe('p-0011223344556677-adec674903d619b39d62c67a42bb3d17')
  expect(W.ticketOf(secret, 'full', '0011223344556677')).toBe('f-0011223344556677-a284df635f2f16617d5887d94954f3f8')
  expect(W.nonceOf('f-0011223344556677-a284df635f2f16617d5887d94954f3f8')).toBe('0011223344556677')
  expect(W.nonceOf('nope')).toBe('')
  expect(W.newSecret()).toMatch(/^[0-9a-f]{64}$/)
  expect(W.newSecret()).not.toBe(W.newSecret())
  expect(W.newNonce()).toMatch(/^[0-9a-f]{16}$/)
  // the server's lines: a command's grade, a missing or odd one read as the Browser pane's; a ticket traded
  expect(W.parseLine('{"cmd":"chat","agentId":"main","text":"hi","grade":"full"}')).toEqual({ kind: 'cmd', cmd: { cmd: 'chat', agentId: 'main', text: 'hi' }, grade: 'full' })
  expect(W.parseLine('{"cmd":"chat","agentId":"main","text":"hi"}')).toEqual({ kind: 'cmd', cmd: { cmd: 'chat', agentId: 'main', text: 'hi' }, grade: 'pane' })
  expect(W.parseLine('{"cmd":"chat","agentId":"main","text":"hi","grade":"FULL"}')).toMatchObject({ grade: 'pane' })
  expect(W.parseLine('{"used":"0011223344556677","grade":"full"}')).toEqual({ kind: 'used', nonce: '0011223344556677', grade: 'full' })
  expect(W.parseLine('{"used":"../x"}')).toBeNull()
})

test('what holds, pure: the commands in your voice (a message, Review, an answer), their words and rows, the long ones, and when they go unsent', () => {
  expect(['chat', 'review', 'answer'].map(cmd => H.isVoice({ cmd }))).toEqual([true, true, true])
  expect(['stopAgent', 'abortTurn', 'stopBackground', 'clearFinished', 'showCleared', 'selectRepo', 'avatarStyle', 'view', 'ping'].some(cmd => H.isVoice({ cmd }))).toBe(false)
  expect(H.wordsOf({ cmd: 'answer', answers: { 'Which store?': 'Redis' } })).toBe('Redis')
  expect(H.wordsOf({ cmd: 'answer', answers: { 'Which store?': 'Redis', 'Which routes?': '/health' } })).toBe('Which store? Redis; Which routes? /health')
  const chat = H.heldOf({ cmd: 'chat', id: 'c-1', agentId: 'main', text: 'line one\nline two ‮' }, 'h1', NOW, '', 'Orchestrator')
  const review = H.heldOf({ cmd: 'review', id: 'r-1', text: 'Review it' }, 'h2', NOW + 1, 'other-1', 'acme-api')
  expect(chat).toMatchObject({ ackId: 'c-1', kind: 'chat', session: '', to: 'Orchestrator' })
  const rows = H.heldRowsOf([chat, review], new Set(['h1']))
  // its words on one line, a bidirectional control as U+FFFD; a break makes it long, and opened it shows whole
  expect(rows[0]).toEqual({ key: 'h1', what: '→ Orchestrator', text: 'line one line two �', whole: 'line one\nline two �', isLong: true, isOpen: true })
  expect(rows[1]).toMatchObject({ what: 'asks acme-api for a review', text: 'Review it', isLong: false, isOpen: false })
  expect(H.expiredOf([chat, review], NOW + H.HOLD_MS)).toEqual([chat])
})
