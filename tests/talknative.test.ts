/**
 * An agent page's Talk (hooks/ui/dash/talk.tsx), as the web deck's thread
 * draws it: others' messages on the left (avatar, bold name, what it was in
 * the web's words, when; the words in a rounded, bordered dark box, Markdown
 * for a brief, a report and an answer), yours on the right in a blue bubble
 * with what came of it from `acks` under it, questions and choices as the
 * web draws them, Show more for a cut message (its whole text read as the
 * web's /message/<id>), "Show n earlier", and the box that sends through
 * the deck's own send with an ack id. Then the same through the deck's pane,
 * live and in /deck demo.
 */
import type { On, RenderElement } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import { agentPage } from '../hooks/ui/dash/agent'
import { agentOf } from '../hooks/ui/dash/dashModel'
import { P, mix } from '../hooks/ui/dash/palette'
import { ackLineOf, kindLabelOf, sendNoteOf, talkTab, threadOf } from '../hooks/ui/dash/talk'
import type { DashActions, Kit } from '../hooks/ui/types'
import * as W from '../hooks/web'
import type { DeckData, DeckSnapshot } from '../types'
import { deck, newWorld, NOW, world, type World } from './world'

const SURFACES = ['terminal', 'desktop'] as const

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane<S extends 'terminal' | 'desktop'>(surface: S, bodyColumns = 84, requestId = 'agent-deck') {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId,
    viewport: { columns: bodyColumns + 4, rows: 60, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }
}

/** The instance a test draws the tab into by itself. */
const PROBE = 'talk-probe'

function probe(on: On, draw: (kit: Kit) => RenderElement, requestId = PROBE): void {
  on('ui.render', { component: 'Pane', requestId }, ($, e) => {
    const ui = $.ui.resolve(e)
    return draw({
      surface: e.surface,
      Box: ui.Box,
      Text: ui.Text,
      Button: ui.Button,
      Code: ui.Code,
      Markdown: ui.Markdown,
      columns: Math.max(24, e.props.bodyColumns - 1),
      ...('Input' in ui ? { Input: ui.Input } : {}),
      ...('Svg' in ui && e.surface !== 'terminal' ? { Svg: ui.Svg } : {}),
    })
  })
}

/** Actions that note each call as `name:args` (JSON, functions left out); `loadMessage` hands back `whole`. */
function noting(calls: string[], whole: string | null = 'The whole answer, every word of it.'): DashActions {
  return new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args: unknown[]) => {
          calls.push(`${String(name)}:${args.filter(one => typeof one !== 'function').map(one => JSON.stringify(one)).join(',')}`)
          const onRead = args[1]
          if (name === 'loadMessage' && typeof onRead === 'function') (onRead as (text: string | null) => void)(whole)
        },
    },
  ) as DashActions
}

/** An answer longer than the 600 characters the state keeps of a message. */
const LONG_ANSWER = [
  'Here is where things stand.',
  '',
  '**Done**',
  ...Array.from({ length: 12 }, (_, i) => `- Step ${i + 1} is finished, and its tests pass on the memory store and on Redis.`),
  '',
  'The last line of the answer.',
].join('\n')

/**
 * A session's talk: your prompt; the Orchestrator delegates to Limiter,
 * asks you a question you answered, hears back from Docs and messages it;
 * you ask how far along it is (queued, then answered: an answer longer than
 * the state keeps); you message Limiter (delivered) and Docs (not: it had
 * finished); the Orchestrator asks a question it holds on you.
 */
function talkData(): DeckData {
  const data = M.emptyData(NOW - 3_600_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  main.model = 'claude-opus-5-5'
  M.noteGoal(data, 'goal', { text: 'Add per-user rate limiting', origin: 'composer', at: NOW - 3_000_000 })
  data.agents.push(M.newAgent('agent-limiter', 'agent', 'Limiter', NOW - 2_400_000, { type: 'general-purpose', parentId: M.MAIN, status: 'running', description: 'Limiter', prompt: 'Write the limiter' }))
  data.agents.push(M.newAgent('agent-docs', 'agent', 'Docs', NOW - 2_000_000, { type: 'general-purpose', parentId: M.MAIN, status: 'completed', endedAt: NOW - 600_000, description: 'Docs', answer: 'Updated docs/api.md' }))
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', at: NOW - 3_000_000, text: 'Add per-user rate limiting to the public API.' })
  M.addMessage(data, { from: M.MAIN, to: 'agent-limiter', kind: 'spawn', at: NOW - 2_400_000, text: 'Write a **sliding-window** limiter in `src/rateLimit.ts`.' })
  M.addMessage(data, { from: M.MAIN, to: M.YOU, kind: 'question', at: NOW - 2_300_000, text: 'Should the limit count per user or per key?', callId: 'toolu_q1' })
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'choice', at: NOW - 2_280_000, text: 'You answered: Per user', callId: 'toolu_q1', ackId: 'a-1' })
  M.noteAck(data, { id: 'a-1', ok: true, status: 'answered', text: 'Claude carries on', at: NOW - 2_280_000 })
  M.addMessage(data, { from: 'agent-docs', to: M.MAIN, kind: 'result', at: NOW - 600_000, text: 'Updated **docs/api.md**: the 429 error and a Rate limits section.' })
  M.addMessage(data, { from: M.MAIN, to: 'agent-docs', kind: 'message', at: NOW - 500_000, text: '/health and /metrics are exempt from the limiter.' })
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'chat', at: NOW - 300_000, text: 'How far along are we?', ackId: 'c-1' })
  M.noteAck(data, { id: 'c-1', ok: true, status: 'queued', text: 'Claude reads it when it finishes its current turn', at: NOW - 300_000 })
  M.addMessage(data, { from: M.MAIN, to: M.YOU, kind: 'answer', at: NOW - 240_000, text: LONG_ANSWER })
  M.addMessage(data, { from: M.YOU, to: 'agent-limiter', kind: 'chat', at: NOW - 120_000, text: 'Keep it synchronous.', ackId: 'c-2' })
  M.noteAck(data, { id: 'c-2', ok: true, status: 'delivered', text: 'It reads it at its next step', at: NOW - 120_000 })
  M.addMessage(data, { from: M.YOU, to: 'agent-docs', kind: 'chat', at: NOW - 60_000, text: 'Also add the 429 example.', ackId: 'c-3' })
  M.noteAck(data, { id: 'c-3', ok: false, status: 'failed', text: 'Docs has finished: start a new agent to take this up', at: NOW - 60_000 })
  M.addMessage(data, { from: M.MAIN, to: M.YOU, kind: 'question', at: NOW - 30_000, text: 'Where should the changelog entry go?', callId: 'toolu_q2' })
  M.notePending(data, {
    id: 'toolu_q2',
    agentId: M.MAIN,
    kind: 'question',
    tool: 'AskUserQuestion',
    at: NOW - 30_000,
    questions: [{ question: 'Where should the changelog entry go?', header: 'Changelog', multiSelect: false, options: [{ label: 'Unreleased', description: '' }, { label: '2.4.0', description: '' }] }],
  })
  return data
}

/** The id the state gives the message whose words start with `text`. */
function idOf(data: DeckData, text: string): string {
  const found = data.messages.find(message => message.text.startsWith(text))
  if (!found) throw new Error(`no message starts with ${text}`)
  return W.webIdOf(found.id)
}

function stateOf(data: DeckData, answerable: string[] = ['toolu_q2']): W.WebState {
  return W.webStateOf(data, M.defaultView(), emptyGit(), null, NOW, 's', '/repo', new Set(answerable))
}

function snapshot(data: DeckData): DeckSnapshot {
  return { v: M.SNAPSHOT_VERSION, data: M.copyOf(data), view: M.defaultView() }
}

/** The deck on `data`, its pane open: tests/world.ts, the Client's posts and faults let go, and `files` for what Talk reads. */
async function started($: Engine, on: On, data: DeckData, files: Record<string, string> = {}, w: World = newWorld()) {
  mock.clock(on, { now: NOW })
  const reads: string[] = []
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    reads.push(path)
    const name = Object.keys(files).find(one => path.endsWith(one))
    return name !== undefined ? { value: files[name] ?? '' } : { deny: 'no such file' }
  })
  world(on, w, snapshot(data))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  return { reads, w }
}

test('the thread`s words as the web`s: whose messages, what each was, and what came of yours', () => {
  const data = talkData()
  const state = stateOf(data)
  // the agent's thread: from it or to it
  expect(threadOf(state, 'agent-limiter').map(message => message.text)).toEqual(['Write a **sliding-window** limiter in `src/rateLimit.ts`.', 'Keep it synchronous.'])
  expect(threadOf(state, 'main').length).toBe(9)

  // what a message was: its kind's word, to whom when the agent itself wrote, "asks you" while held
  const label = (text: string, agentId: string, isHeld = false) => kindLabelOf(state, state.messages.find(message => message.text.startsWith(text))!, agentId, isHeld)
  expect(label('Write a **sliding', 'main')).toBe('delegated to Limiter')
  expect(label('Write a **sliding', 'agent-limiter')).toBe('delegated')
  expect(label('Updated **docs', 'main')).toBe('reported back')
  expect(label('Updated **docs', 'agent-docs')).toBe('reported back to Orchestrator')
  expect(label('/health and', 'main')).toBe('message to Docs')
  expect(label('Here is where', 'main')).toBe('replied')
  expect(label('Should the limit', 'main')).toBe('asked you')
  expect(label('Where should the changelog', 'main', true)).toBe('asks you')

  // an ack in the web's words
  expect(ackLineOf({ id: 'x', ok: true, status: 'queued', text: 'Claude reads it when it finishes its current turn', at: NOW }).text).toBe('Queued: Claude reads it when it finishes its current turn')
  expect(ackLineOf({ id: 'x', ok: true, status: 'delivered', text: 'It reads it at its next step', at: NOW }).text).toBe('Delivered: it reads it at its next step')
  expect(ackLineOf({ id: 'x', ok: true, status: 'delivered', text: 'Passed on by the Orchestrator', at: NOW }).text).toBe('Delivered: Passed on by the Orchestrator')
  expect(ackLineOf({ id: 'x', ok: true, status: 'queued', text: 'Waiting for the Orchestrator to pass it on', at: NOW })).toEqual({ mark: '◷', tone: 'wait', text: 'Queued: Waiting for the Orchestrator to pass it on' })
  expect(ackLineOf({ id: 'x', ok: false, status: 'failed', text: 'Docs has finished: start a new agent to take this up', at: NOW })).toEqual({ mark: '✕', tone: 'fail', text: 'Not delivered: Docs has finished: start a new agent to take this up' })
  expect(ackLineOf({ id: 'x', ok: false, status: 'failed', text: 'Not delivered: in auto mode, Claude Code does not take it', at: NOW }).text).toBe('Not delivered: in auto mode, Claude Code does not take it')
  expect(ackLineOf({ id: 'x', ok: true, status: 'answered', text: 'Claude carries on', at: NOW })).toEqual({ mark: '✓', tone: 'done', text: 'Answered: Claude carries on' })

  // the note under a message: settled once the agent replied after it; a failure stays red; a choice and one with no ack have none
  const message = (text: string) => state.messages.find(one => one.text.startsWith(text))!
  expect(sendNoteOf(state, 'main', message('How far along'), null, NOW)).toMatchObject({ tone: 'wait', isSettled: true })
  expect(sendNoteOf(state, 'agent-limiter', message('Keep it synchronous'), null, NOW)).toMatchObject({ tone: 'done', text: 'Delivered: it reads it at its next step', isSettled: false })
  expect(sendNoteOf(state, 'agent-docs', message('Also add the 429'), null, NOW)).toMatchObject({ tone: 'fail', isSettled: false })
  expect(sendNoteOf(state, 'main', message('You answered'), null, NOW)).toBeNull()
  expect(sendNoteOf(state, 'main', message('Add per-user'), null, NOW)).toBeNull()
  // a send from here not acked yet: Sending…, then after a while that none came
  const send = { id: 't-new', text: 'Hello', at: NOW - 1_000 }
  expect(sendNoteOf(state, 'main', null, send, NOW)).toMatchObject({ mark: '◐', tone: 'run', text: 'Sending…' })
  expect(sendNoteOf(state, 'main', null, send, NOW + 30_000)?.text).toBe("Sent, but Claude Code hasn't confirmed it")
})

test('Talk draws the thread as the web`s chat: theirs on the left in bordered dark boxes, yours on the right in blue with what came of each, a question and its choice, Show more, and the box that sends', async ($, on) => {
  const data = talkData()
  const calls: string[] = []
  const shown = { agent: 'main', state: stateOf(data) }
  probe(on, kit => talkTab(kit, shown.state, agentOf(shown.state, shown.agent)!, M.defaultView(), noting(calls), NOW))
  mock.clock(on, { now: NOW })
  world(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  const ids = {
    prompt: idOf(data, 'Add per-user'),
    spawn: idOf(data, 'Write a **sliding'),
    asked: idOf(data, 'Should the limit'),
    result: idOf(data, 'Updated **docs'),
    message: idOf(data, '/health and'),
    answer: idOf(data, 'Here is where'),
    held: idOf(data, 'Where should the changelog'),
  }
  for (const surface of SURFACES) {
    shown.agent = 'main'
    shown.state = stateOf(data)
    const ui = await $.ui.mount(pane(surface, 84, PROBE))
    // the Orchestrator's thread, oldest first: yours keyed by the command they went with
    const keys = (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('msg:'))
    expect(keys).toEqual([`msg:${ids.prompt}`, `msg:${ids.spawn}`, `msg:${ids.asked}`, 'msg:out:a-1', `msg:${ids.result}`, `msg:${ids.message}`, 'msg:out:c-1', `msg:${ids.answer}`, `msg:${ids.held}`])

    // theirs: the sender's face, name in bold, what it was and when; the words in a rounded, bordered dark box
    const spawn = await ui.find({ key: `msg:${ids.spawn}` })
    expect(spawn?.props.alignItems).toBeUndefined()
    expect(spawn?.text).toContain('Orchestrator' + '  delegated to Limiter  40m')
    expect((await ui.find({ type: 'Text', text: /^Orchestrator$/ }))?.props).toMatchObject({ bold: true, color: P.text })
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some(svg => svg.props.alt === "Orchestrator's avatar")).toBe(true)
    const boxes = await ui.findAll({ type: 'Box' })
    const boxOf = (text: string) => boxes.find(box => box.props.borderStyle === 'round' && box.text.includes(text) && !box.text.includes('Orchestrator'))
    expect(boxOf('sliding-window')?.props).toMatchObject({ borderColor: P.border, backgroundColor: '#1d1d1d' })
    // a brief, a report and an answer are Markdown; a message is words
    const markdown = (await ui.findAll({ type: 'Markdown' })).map(one => String(one.props.text))
    expect(markdown[0]).toBe('Write a **sliding-window** limiter in `src/rateLimit.ts`.')
    expect(markdown.some(text => text.startsWith('Updated **docs/api.md**'))).toBe(true)
    expect(markdown.some(text => text.startsWith('Here is where things stand.'))).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^\/health and \/metrics are exempt/ }))?.props.color).toBe(P.fg2)
    expect((await ui.find({ key: `msg:${ids.message}` }))?.text).toContain('message to Docs')
    // a report's edge is green
    expect(boxOf('Rate limits section')?.props.borderColor).toBe(mix(P.card, P.done, 0.3))

    // yours, on the right: You and when; the blue bubble, white words, at most three quarters wide
    const prompt = await ui.find({ key: `msg:${ids.prompt}` })
    expect(prompt?.props.alignItems).toBe('flex-end')
    expect(prompt?.text.startsWith('You' + '  prompt  50m')).toBe(true)
    expect(boxes.some(box => box.props.backgroundColor === '#2563eb' && box.text.includes('Add per-user'))).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^Add per-user rate limiting/ }))?.props.color).toBe('#ffffff')
    expect(boxes.some(box => box.props.width === '75%' && box.text.includes('Add per-user'))).toBe(true)

    // under yours, what came of it: queued, dim once the Orchestrator answered after it; a choice has none
    const chat = await ui.find({ key: 'msg:out:c-1' })
    expect(chat?.text).toContain('How far along are we?')
    expect(chat?.text).toContain('Queued: Claude reads it when it finishes its current turn')
    expect((await ui.find({ type: 'Text', text: /^Queued: Claude reads it/ }))?.props.color).toBe(P.muted2)
    expect((await ui.find({ key: 'msg:out:a-1' }))?.text).not.toContain('Answered')

    // a question asked and how you answered it: its words bold beside a question mark; your choice with a green ✓ in a dark bubble
    expect((await ui.find({ key: `msg:${ids.asked}` }))?.text).toContain('asked you')
    expect((await ui.find({ type: 'Text', text: /^Should the limit count per user or per key\?$/ }))?.props).toMatchObject({ bold: true, color: P.text })
    const choice = boxes.find(box => box.props.borderStyle === 'round' && box.text.includes('You answered: Per user'))
    expect(choice?.props).toMatchObject({ borderColor: mix(P.card, '#ffffff', 0.16), backgroundColor: '#1d1d1d' })
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some(svg => svg.props.alt === 'Done')).toBe(true)
    else expect(choice?.text.startsWith('✓')).toBe(true)

    // the question held on you: "asks you", amber, and "Answer it above ↑" brings its card into view
    expect((await ui.find({ key: `msg:${ids.held}` }))?.text).toContain('asks you')
    expect(boxOf('Where should the changelog')?.props.borderColor).toBe(mix(P.card, P.wait, 0.4))
    calls.length = 0
    await ui.press({ plugin: 'test', key: `msg:answer:${ids.held}` })
    expect(calls).toEqual(['reveal:"needs:toolu_q2","start"'])

    // the answer the state cut: Show more reads it whole (once) and brings it into view; Show less folds it
    expect(shown.state.messages.find(message => message.id === ids.answer)?.isCut).toBe(true)
    expect((await ui.find({ key: `msg:more:${ids.answer}` }))?.text).toBe('Show more')
    calls.length = 0
    await ui.press({ plugin: 'test', key: `msg:more:${ids.answer}` })
    await ui.redraw()
    const reveal = `reveal:"msg:${ids.answer}","nearest"`
    expect(calls).toEqual(surface === 'terminal' ? [`loadMessage:"${ids.answer}"`, reveal, 'redraw:'] : [reveal, 'redraw:'])
    expect((await ui.findAll({ type: 'Markdown' })).some(one => one.props.text === 'The whole answer, every word of it.')).toBe(true)
    expect((await ui.find({ key: `msg:more:${ids.answer}` }))?.text).toBe('Show less')
    await ui.press({ plugin: 'test', key: `msg:more:${ids.answer}` })
    await ui.redraw()
    expect((await ui.find({ key: `msg:more:${ids.answer}` }))?.text).toBe('Show more')

    // the box that sends: the field, Send, and how the Orchestrator reads it while it works
    const field = await ui.find({ key: 'chat:main' })
    expect(field?.type).toBe('Input')
    expect(field?.props).toMatchObject({ placeholder: 'Message Orchestrator…', submitLabel: 'send', value: '' })
    expect((await ui.find({ key: 'talk:send:main' }))?.props).toMatchObject({ label: 'Send', variant: 'primary' })
    expect(await ui.find({ type: 'Text', text: 'Claude reads it when it finishes its current turn.' })).toBeDefined()

    // Limiter's thread: delegated by the Orchestrator; yours delivered, in its hue while Limiter has not replied
    shown.agent = 'agent-limiter'
    await ui.redraw()
    expect((await ui.find({ key: `msg:${ids.spawn}` }))?.text).toContain('Orchestrator' + '  delegated  40m')
    expect((await ui.find({ key: 'msg:out:c-2' }))?.text).toContain('Delivered: it reads it at its next step')
    expect((await ui.find({ type: 'Text', text: /^Delivered: it reads it/ }))?.props.color).toBe(P.muted)
    expect((await ui.find({ type: 'Text', text: /^✓$/ }))?.props.color).toBe(P.doneText)
    expect(await ui.find({ type: 'Text', text: 'It reads it at its next step; nothing is interrupted.' })).toBeDefined()

    if (surface === 'desktop') {
      // a send: through the deck's send with an ack id, shown at once with Sending…, the field empty again
      calls.length = 0
      await ui.input({ plugin: 'test', key: 'chat:agent-limiter', text: 'Use the memory store in tests.', kind: 'change' })
      await ui.press({ plugin: 'test', key: 'talk:send:agent-limiter' })
      await ui.redraw()
      const sent = calls.find(one => one.startsWith('sendChat:')) ?? ''
      const ackId = /,"(t[0-9a-z]+)"$/.exec(sent)?.[1] ?? ''
      expect(sent).toBe(`sendChat:"agent-limiter","Use the memory store in tests.","${ackId}"`)
      expect(ackId).toMatch(/^[A-Za-z0-9_-]{1,40}$/)
      expect(calls).toContain('followTalk:')
      const sending = await ui.find({ key: `msg:out:${ackId}` })
      expect(sending?.text).toContain('Use the memory store in tests.')
      expect(sending?.text).toContain('Sending…')
      expect(await ui.find({ key: 'chat:agent-limiter' })).toBeUndefined()
      expect((await ui.find({ key: 'chat:agent-limiter:1' }))?.props.value).toBe('')
      // the deck logs it under that id and acks it: the same bubble says what came of it
      const later = M.copyOf(data)
      M.addMessage(later, { from: M.YOU, to: 'agent-limiter', kind: 'chat', at: NOW, text: 'Use the memory store in tests.', ackId })
      M.noteAck(later, { id: ackId, ok: true, status: 'delivered', text: 'It reads it at its next step', at: NOW })
      shown.state = stateOf(later)
      await ui.redraw()
      const delivered = await ui.find({ key: `msg:out:${ackId}` })
      expect(delivered?.text).toContain('Delivered: it reads it at its next step')
      expect(delivered?.text).not.toContain('Sending…')
      expect((await ui.findAll({ type: 'Box' })).filter(box => box.text.includes('Use the memory store in tests.') && box.key?.startsWith('msg:')).length).toBe(1)
    }

    // Docs' thread: its report "to Orchestrator"; yours not delivered, in red
    shown.agent = 'agent-docs'
    await ui.redraw()
    expect((await ui.find({ key: `msg:${ids.result}` }))?.text).toContain('reported back to Orchestrator')
    expect((await ui.find({ type: 'Text', text: /^Not delivered: Docs has finished/ }))?.props.color).toBe(P.failText)
    expect(await ui.find({ type: 'Text', text: 'Resumes the agent to answer.' })).toBeDefined()
    await ui.unmount()
  }
})

test('a long thread shows its newest 24, "Show n earlier" pages back; one with nothing says so', async ($, on) => {
  const data = talkData()
  data.agents.push(M.newAgent('agent-chatty', 'agent', 'Chatty', NOW - 200_000, { type: 'general-purpose', parentId: M.MAIN, status: 'running', description: 'Chatty' }))
  for (let i = 0; i < 30; i++) M.addMessage(data, { from: i % 2 ? 'agent-chatty' : M.YOU, to: i % 2 ? M.YOU : 'agent-chatty', kind: 'chat', at: NOW - 100_000 + i * 1000, text: `Line ${i + 1}` })
  const state = stateOf(data)
  probe(on, kit => talkTab(kit, state, agentOf(state, 'agent-chatty')!, M.defaultView(), noting([]), NOW))
  const lone = W.webStateOf(M.emptyData(NOW), M.defaultView(), emptyGit(), null, NOW, 's', '/repo')
  probe(on, kit => talkTab(kit, lone, agentOf(lone, 'main')!, M.defaultView(), noting([]), NOW), 'talk-lone')
  mock.clock(on, { now: NOW })
  world(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  const ui = await $.ui.mount(pane('desktop', 84, PROBE))
  const count = async () => (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('msg:')).length
  // 30 in all: the newest 24, and a press for the 6 before them
  expect(await count()).toBe(24)
  expect((await ui.find({ key: 'talk:earlier:agent-chatty' }))?.props).toMatchObject({ label: 'Show 6 earlier', plain: true })
  expect((await ui.findAll({ type: 'Text' })).some(text => text.text === 'Line 7')).toBe(true)
  expect((await ui.findAll({ type: 'Text' })).some(text => text.text === 'Line 6')).toBe(false)
  await ui.press({ plugin: 'test', key: 'talk:earlier:agent-chatty' })
  await ui.redraw()
  expect(await count()).toBe(30)
  expect(await ui.find({ key: 'talk:earlier:agent-chatty' })).toBeUndefined()
  await ui.unmount()
  // an agent nobody talked with: a quiet line, and the box
  const empty = await $.ui.mount(pane('terminal', 84, 'talk-lone'))
  expect(await empty.find({ type: 'Text', text: 'No messages with Orchestrator yet.' })).toBeDefined()
  expect(await empty.find({ key: 'chat:main' })).toBeDefined()
  await empty.unmount()
})

test('a press on the Talk tab takes the pane to its end; a press on another tab does not', async ($, on) => {
  const data = talkData()
  const state = stateOf(data)
  const calls: string[] = []
  const view = { ...M.defaultView(), page: 'agent-limiter', agentPane: 'activity' as const }
  probe(on, kit => agentPage(kit, state, data, view, noting(calls), NOW))
  mock.clock(on, { now: NOW })
  world(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  const ui = await $.ui.mount(pane('desktop', 84, PROBE))
  calls.length = 0
  await ui.press({ plugin: 'test', key: 'detail:chat' })
  expect(calls).toEqual(['setAgentPane:"chat"', 'followTalk:'])
  calls.length = 0
  await ui.press({ plugin: 'test', key: 'detail:edits' })
  expect(calls).toEqual(['setAgentPane:"edits"'])
  await ui.unmount()
})

test('through the pane: Show more reads the whole text (the deck`s own copy, the web deck`s file, else the deck`s cut), and Send goes through the deck`s send with an ack id: what came of it under the message, the field empty again', async ($, on) => {
  const data = talkData()
  // an answer whose whole text the web deck wrote to its file already, and one nothing kept whole
  const saved = M.addMessage(data, { from: M.MAIN, to: M.YOU, kind: 'answer', at: NOW - 20_000, text: `${LONG_ANSWER}\nSaved.` })
  saved.isSaved = true
  delete saved.full
  const gone = M.addMessage(data, { from: M.MAIN, to: M.YOU, kind: 'answer', at: NOW - 10_000, text: `${LONG_ANSWER}\nGone.` })
  gone.isSaved = true
  delete gone.full
  const answer = idOf(data, 'Here is where')
  const { reads, w } = await started($, on, data, { [`messages/${W.webIdOf(saved.id)}.md`]: 'The saved answer, whole.\n' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'dash:agent:main' })
    await ui.redraw()
    // the Orchestrator's page opens on Talk: its messages, and yours sent from here before
    expect((await ui.find({ key: 'detail:chat' }))?.props).toMatchObject({ label: `Talk ${surface === 'terminal' ? 11 : 12}`, dimColor: false })

    // the deck's own whole text: no file read
    await ui.press({ key: `msg:more:${answer}` })
    await ui.redraw()
    expect((await ui.findAll({ type: 'Markdown' })).some(one => String(one.props.text).endsWith('The last line of the answer.'))).toBe(true)
    expect((await ui.find({ key: `msg:more:${answer}` }))?.text).toBe('Show less')
    // the web deck's file, as /message/<id> serves it
    await ui.press({ key: `msg:more:${W.webIdOf(saved.id)}` })
    await ui.redraw()
    expect(reads.some(path => path.endsWith(`/.web/session-1/messages/${W.webIdOf(saved.id)}.md`))).toBe(true)
    expect((await ui.findAll({ type: 'Markdown' })).some(one => one.props.text === 'The saved answer, whole.')).toBe(true)
    // nowhere to be had whole: the deck's own cut, the most there is
    await ui.press({ key: `msg:more:${W.webIdOf(gone.id)}` })
    await ui.redraw()
    expect((await ui.findAll({ type: 'Markdown' })).some(one => String(one.props.text).startsWith('Here is where') && Array.from(String(one.props.text)).length > 600)).toBe(true)
    for (const id of [answer, W.webIdOf(saved.id), W.webIdOf(gone.id)]) {
      await ui.press({ key: `msg:more:${id}` })
      await ui.redraw()
    }

    // to the Orchestrator: typed, then Send: your next prompt, logged as yours under the command's id with what came of it
    const before = w.submitted.length
    const field = (await ui.findAll({ type: 'Input' }))[0]
    await ui.input({ key: field?.key ?? '', text: 'And the changelog?', kind: 'change' })
    await ui.press({ key: 'talk:send:main' })
    await ui.redraw()
    expect(w.submitted.slice(before).map(one => one.text)).toEqual(['And the changelog?'])
    const sent = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('msg:out:t'))
    expect(sent.length).toBe(surface === 'terminal' ? 1 : 2)
    expect(sent[sent.length - 1]?.text).toContain('And the changelog?')
    expect(sent[sent.length - 1]?.text).toMatch(/Queued: Claude reads it when it finishes its current turn|Delivered: Claude reads it now/)
    // the field starts empty again
    const fresh = (await ui.findAll({ type: 'Input' }))[0]
    expect(fresh?.key).toBe(`chat:main:${surface === 'terminal' ? 1 : 2}`)
    expect(fresh?.props.value).toBe('')
    await ui.press({ key: 'page:back' })
    await ui.redraw()

    // to Limiter, with Enter: delivered to its inbox, and so it says under your message
    await ui.press({ key: 'dash:agent:agent-limiter' })
    await ui.redraw()
    await ui.press({ key: 'detail:chat' })
    await ui.redraw()
    const limiterField = (await ui.findAll({ type: 'Input' }))[0]
    await ui.input({ key: limiterField?.key ?? '', text: 'Use the memory store in tests.' })
    await ui.redraw()
    expect(w.sent.filter(one => one.text === 'Use the memory store in tests.').length).toBe(surface === 'terminal' ? 1 : 2)
    const mine = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('msg:out:t'))
    expect(mine[mine.length - 1]?.text).toContain('Use the memory store in tests.')
    expect(mine[mine.length - 1]?.text).toContain('Delivered: it reads it at its next step')
    await ui.press({ key: 'page:back' })
    await ui.redraw()
    await ui.unmount()
  }
})

/**
 * A sample in web/fixtures/state.json's shape: the Orchestrator asked you
 * a question you answered, you asked how far along it is (queued) and its
 * answer came back longer than the state keeps (its whole text in
 * messages/<id>.md); a question it holds on you.
 */
function sampleOf(): { text: string; id: string } {
  const data = talkData()
  const state = W.webStateOf(data, M.defaultView(), emptyGit(), null, NOW, 'sample', '/acme', new Set(['toolu_q2']))
  return { text: JSON.stringify(state), id: idOf(data, 'Here is where') }
}

test('in /deck demo the Orchestrator`s Talk is full: the question and its choice, what came of your message, the answer cut with Show more read from the fixture`s messages; Send sends nothing', async ($, on) => {
  const sample = sampleOf()
  const w = newWorld()
  const reads: string[] = []
  mock.clock(on, { now: NOW })
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    reads.push(path)
    if (path.endsWith('/web/fixtures/state.json')) return { value: sample.text }
    if (path.endsWith(`/web/fixtures/messages/${sample.id}.md`)) return { value: 'The whole sample answer.\n' }
    return { deny: 'no such file' }
  })
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'dash:agent:main' })
    await ui.redraw()
    expect((await ui.find({ key: 'detail:chat' }))?.props.dimColor).toBe(false)
    // the question asked and answered; the one held, answerable above
    expect(await ui.find({ type: 'Text', text: /^You answered: Per user$/ })).toBeDefined()
    expect((await ui.find({ key: 'msg:out:c-1' }))?.text).toContain('Queued: Claude reads it when it finishes its current turn')
    const held = (await ui.findAll({ type: 'Button' })).find(button => button.key?.startsWith('msg:answer:'))
    expect(held?.text).toBe('Answer it above ↑')
    // the answer the sample cut: its whole text from the fixture's messages
    await ui.press({ key: `msg:more:${sample.id}` })
    await ui.redraw()
    expect(reads.some(path => path.endsWith(`/web/fixtures/messages/${sample.id}.md`))).toBe(true)
    expect((await ui.findAll({ type: 'Markdown' })).some(one => one.props.text === 'The whole sample answer.')).toBe(true)
    await ui.press({ key: `msg:more:${sample.id}` })
    await ui.redraw()
    // nothing goes from the sample, and nothing shows as sent
    await ui.input({ key: 'chat:main', text: 'hello' })
    await ui.redraw()
    expect(w.toasts).toContain('Sample data: nothing is sent. Back to this chat to talk to your agents.')
    expect(w.submitted.filter(one => one.text === 'hello')).toEqual([])
    expect((await ui.findAll({ type: 'Box' })).some(box => box.key?.startsWith('msg:out:t'))).toBe(false)
    expect(await ui.find({ key: 'chat:main' })).toBeDefined()
    await ui.press({ key: 'page:back' })
    await ui.redraw()
    await ui.unmount()
  }
})
