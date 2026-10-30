/**
 * What the agents say between their tool calls: each model step's visible
 * text, and its thinking as Claude Code shows it, read from `turn.step` as
 * the response streams (every chunk passed on as it came), kept per agent
 * (the newest 60, each at most 4000 characters) and never put in Chat. The
 * state cuts them at 600: a row's words since its latest call (its live
 * line while no call is in flight), Recent activity's said rows (never a
 * thought, never what Chat holds already), and each agent file's words,
 * which its page's Activity lays between its calls unless "Calls only" is
 * picked.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import * as D from '../hooks/ui/v2/dashModel'
import { THOUGHT_NOTE, THOUGHT_WORD } from '../hooks/ui/v2/page'
import * as W from '../hooks/web'
import type { DeckAgent, DeckData } from '../types'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { command, deck, newWorld, NOW, step, work, world, type World } from './world'

const SCOUT = 'agent-x1'
const SCOUT_FILE = 'agent-2dx1'

/** The v2 state of the latest state.json written. */
function v2Of(w: World): W.WebStateV2 {
  const states = w.writes.filter(one => /[\\/]\.web[\\/]session-1[\\/]state\.json$/.test(one.path))
  const last = states[states.length - 1]
  if (!last) throw new Error('no state.json was written')
  return (JSON.parse(last.text) as { v2: W.WebStateV2 }).v2
}

/** The latest agents/<id>.json written for `fileId`. */
function fileOf(w: World, fileId: string): W.V2AgentFile {
  const writes = w.writes.filter(one => one.path.replace(/\\/g, '/').endsWith(`/agents/${fileId}.json`))
  const last = writes[writes.length - 1]
  if (!last) throw new Error(`no agents/${fileId}.json was written`)
  return JSON.parse(last.text) as W.V2AgentFile
}

function rowOf(state: Pick<W.WebStateV2, 'agents'>, id: string): W.V2AgentRow {
  const row = state.agents.find((one): one is W.V2AgentRow => one.row === 'agent' && one.id === id)
  if (!row) throw new Error(`no row ${id}`)
  return row
}

/** The v2 state of `data` at `now`, no repository. */
function stateOf(data: DeckData, now = NOW + 60_000): W.WebStateV2 {
  return W.deckStateOf(data, emptyGit(), null, now, 'session-1', '/work')
}

/** A call begun and ended in `agent`'s loop. */
function call(data: DeckData, agent: DeckAgent, id: string, at: number, ok = true) {
  M.beginTool(data, agent, M.activityOf(id, 'Read', { file_path: `/work/${id}.ts` }, '/work', at))
  M.endTool(agent, id, ok, at + 5)
}

/** A step's words of `agent`'s loop. */
function said(agent: DeckAgent, text: string, at: number, kind: 'said' | 'thought' = 'said', step = 0) {
  M.noteWord(agent, { kind, text, at, turnId: 't1', step })
}

test('each step`s words are kept on its agent: its visible text with when and which step, its thinking as Claude Code streamed it (a block on lines of its own); every chunk passes on as it came; none of it reaches Chat', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)

  // scout thinks, speaks and asks to read: what the step streams comes out of the deck unchanged
  w.steps.push({ answer: 'Reading src/range.js first.', thinking: ['The bug is ', 'in the loop.', [2, 'Then the bound.']], tools: ['Read'] })
  const stream = $.turn.step({ turnId: `turn-${SCOUT}`, index: 0, model: 'claude-test', messageCount: 3, agentId: SCOUT })
  const chunks: unknown[] = []
  let read = await stream.next()
  while (!read.done) {
    chunks.push(read.value)
    read = await stream.next()
  }
  expect(chunks).toEqual([
    { kind: 'thinking', index: 0, text: 'The bug is ' },
    { kind: 'thinking', index: 0, text: 'in the loop.' },
    { kind: 'thinking', index: 2, text: 'Then the bound.' },
    { kind: 'text', index: 1, text: 'Reading src/range.js first.' },
  ])
  // and its result as it came
  expect(read.value).toMatchObject({ index: 0, answer: 'Reading src/range.js first.', toolUses: [{ name: 'Read', input: {} }], stopReason: 'tool_use' })
  await clock.advance(1000)
  await $.tool.call({ tool: 'Read', file_path: '/work/src/range.js', tool_use_id: 'toolu_r1', agentId: SCOUT } as never)
  await clock.advance(1000)
  // a step that only calls tools says nothing; the next speaks after the read
  w.steps.push({ answer: '', tools: ['Grep'] }, { answer: 'Found it: the loop runs to length.', tools: ['Edit'] })
  await step($, SCOUT, 1)
  await step($, SCOUT, 2)
  // the Orchestrator's words between its calls, a moment later
  await clock.advance(500)
  w.steps.push({ answer: 'Waiting for scout.', tools: ['TaskOutput'] })
  await step($, undefined, 1)
  await clock.advance(400)

  expect(fileOf(w, SCOUT_FILE).words).toEqual([
    { kind: 'thought', at: NOW, step: 0, text: 'The bug is in the loop.\n\nThen the bound.', after: '' },
    { kind: 'said', at: NOW, step: 0, text: 'Reading src/range.js first.', after: '' },
    { kind: 'said', at: NOW + 2000, step: 2, text: 'Found it: the loop runs to length.', after: 'toolu_r1' },
  ])
  expect(fileOf(w, 'main').words).toEqual([{ kind: 'said', at: NOW + 2500, step: 1, text: 'Waiting for scout.', after: '' }])
  const state = v2Of(w)
  // its live line: its words since its latest call
  expect(rowOf(state, SCOUT).said).toEqual({ text: 'Found it: the loop runs to length.', at: NOW + 2000 })
  expect(rowOf(state, M.MAIN).said).toEqual({ text: 'Waiting for scout.', at: NOW + 2500 })
  // Recent activity: what they said, never a thought
  expect(state.activity.filter(one => one.kind === 'said').map(one => [one.agent, one.tool, one.text, one.ok])).toEqual([
    [M.MAIN, '', 'Waiting for scout.', null],
    [SCOUT, '', 'Found it: the loop runs to length.', null],
    [SCOUT, '', 'Reading src/range.js first.', null],
  ])
  // Chat holds none of it
  expect(state.chat.map(row => row.text).filter(text => /Reading src|Found it|Waiting for scout|The bug is/.test(text))).toEqual([])
})

test('a turn`s last step (it asks for no call) and an agent`s reply to your message are Chat`s already: in its log, out of Recent activity, and in Chat once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  // you message scout; its next step's words are its reply
  command(w.children[0], { cmd: 'chat', id: 'c1', agentId: SCOUT, text: 'Look at the loop bound first' })
  await clock.settle()
  await clock.advance(1000)
  w.steps.push({ answer: 'Will do: the bound first.', tools: ['Read'] })
  await step($, SCOUT, 0)
  // the Orchestrator's last step: its answer to you
  w.steps.push({ answer: 'Fixed: the loop stops at length - 1.' })
  await step($, undefined, 0)
  await $.turn.complete({ turnId: 't1', answer: 'Fixed: the loop stops at length - 1.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await clock.advance(400)
  const state = v2Of(w)
  expect(fileOf(w, SCOUT_FILE).words.map(one => one.text)).toEqual(['Will do: the bound first.'])
  expect(fileOf(w, 'main').words.map(one => one.text)).toEqual(['Fixed: the loop stops at length - 1.'])
  expect(state.activity.filter(one => one.kind === 'said')).toEqual([])
  expect(state.chat.filter(row => row.text === 'Will do: the bound first.').map(row => [row.from, row.kind])).toEqual([[SCOUT, 'chat']])
  expect(state.chat.filter(row => row.text === 'Fixed: the loop stops at length - 1.').map(row => [row.from, row.kind])).toEqual([[M.MAIN, 'answer']])
})

test('the live line: an agent`s words since its latest call while it is at work; a call begun since, or its run`s end, takes them off; a thought alone is no words', () => {
  const data = M.emptyData(NOW)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  said(main, 'Looking around first.', NOW)
  let row = rowOf(stateOf(data), M.MAIN)
  expect(row.said).toEqual({ text: 'Looking around first.', at: NOW })
  expect([D.cardLine(row), D.isSaidLine(row)]).toEqual(['“Looking around first.”', true])
  // a call in flight shows instead, and its words came before it
  M.beginTool(data, main, M.activityOf('c1', 'Read', { file_path: '/work/a.ts' }, '/work', NOW + 10))
  row = rowOf(stateOf(data), M.MAIN)
  expect([row.said, row.live?.tool, D.isSaidLine(row)]).toEqual([undefined, 'Read', false])
  expect(D.cardLine(row)).toMatch(/^Read /)
  M.endTool(main, 'c1', true, NOW + 20)
  expect(rowOf(stateOf(data), M.MAIN).said).toBeUndefined()
  // what it thought is no words of its live line; what it said next is
  said(main, 'Thinking it over.', NOW + 30, 'thought', 1)
  expect(rowOf(stateOf(data), M.MAIN).said).toBeUndefined()
  said(main, 'a.ts holds the loop.', NOW + 30, 'said', 1)
  expect(rowOf(stateOf(data), M.MAIN).said).toEqual({ text: 'a.ts holds the loop.', at: NOW + 30 })
  // its turn ended: idle, its line is its answer again
  main.status = 'idle'
  M.noteMainAnswer(main, 'Done.')
  row = rowOf(stateOf(data), M.MAIN)
  expect([row.said, D.cardLine(row)]).toEqual([undefined, 'Done.'])
})

test('caps: a loop keeps its newest 60 words, each at most 4000 characters (isCut), whole in its file; the state cuts them at 600; thinking past what a word keeps goes unread', async ($, on) => {
  const data = M.emptyData(NOW)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  for (let i = 0; i < 70; i++) said(main, `word ${i}`, NOW + i, 'said', i)
  expect(main.words?.length).toBe(60)
  expect(main.words?.[0]?.text).toBe('word 10')
  said(main, 'x'.repeat(5000), NOW + 100, 'said', 100)
  const kept = main.words![main.words!.length - 1]!
  expect([kept.text.length, kept.text.endsWith('…'), kept.isCut, main.words?.length]).toEqual([4000, true, true, 60])
  const state = stateOf(data)
  const row = rowOf(state, M.MAIN)
  expect([Array.from(row.said?.text ?? '').length <= 600, row.said?.isCut]).toEqual([true, true])
  const top = state.activity[0]!
  expect([top.kind, Array.from(top.text).length <= 600, top.isCut, state.activity.length]).toEqual(['said', true, true, W.V2_CAPS.activity])
  const file = W.agentFileOf(data, main)
  expect(file.words.length).toBe(60)
  expect(file.words[file.words.length - 1]).toMatchObject({ isCut: true, text: kept.text })
  // a snapshot's words come back in their own shape; others go
  const odd = M.copyOf(data)
  const oddMain = M.agentOf(odd, M.MAIN)!
  oddMain.words = [...(oddMain.words ?? []).slice(-2), { kind: 'said', text: 5 } as never, { kind: 'shout', text: 'hi', at: NOW, turnId: 't', step: 0, after: '' } as never]
  expect(M.agentOf(M.healData(odd, NOW), M.MAIN)?.words?.map(one => one.step)).toEqual([69, 100])

  // thinking streamed long: read to what a word keeps, kept cut
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  w.steps.push({ answer: '', thinking: Array.from({ length: 10 }, () => 'y'.repeat(1000)), tools: ['Read'] })
  await step($, SCOUT, 0)
  await clock.advance(400)
  const thought = fileOf(w, SCOUT_FILE).words[0]!
  expect([thought.kind, thought.text.length, thought.isCut]).toEqual(['thought', 4000, true])
})

test('Recent activity: what the agents said among their calls, newest first, the words before the call that followed them at the same moment; never a thought; the Dashboard`s rows say "said", quoted, with no outcome, and keep ⊘ denied', () => {
  const data = M.emptyData(NOW)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  call(data, main, 'c1', NOW)
  said(main, 'Now the second file.', NOW + 5, 'thought', 1)
  said(main, 'Now the second file.', NOW + 5, 'said', 1)
  call(data, main, 'c2', NOW + 5)
  expect(stateOf(data).activity.map(one => one.kind ?? one.id)).toEqual(['c2', 'said', 'c1'])
  // the sample: builder's and reviewer's words among the newest ten, builder's refused push still marked
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const rows = D.activityRows(state, 10)
  expect(rows.filter(one => one.isSaid).map(one => [one.name, one.verb, one.text.slice(0, 20), one.outcome.text])).toEqual([
    ['builder', 'said', '“Running the limiter', ''],
    ['reviewer', 'said', '“Checking the window', ''],
    ['builder', 'said', '“The bench holds 10,', ''],
  ])
  expect(D.activityRows(state, 40).find(one => one.text === 'Push the limiter')?.outcome).toMatchObject({ mark: '⊘', text: 'denied' })
})

test('an agent`s log lays its words after the call they followed (those before its first call first); Calls only leaves them out; words between calls no longer kept stay out of its file', () => {
  const data = M.emptyData(NOW)
  const main = M.agentOf(data, M.MAIN)!
  said(main, 'Starting.', NOW)
  call(data, main, 'c1', NOW + 10)
  said(main, 'Hmm.', NOW + 20, 'thought', 1)
  said(main, 'One more.', NOW + 20, 'said', 1)
  call(data, main, 'c2', NOW + 30)
  const file = W.agentFileOf(data, main)
  const kinds = (log: W.V2LogEntry[]) => log.map(one => (one.kind === 'call' ? one.call.id : `${one.kind}:${one.word.text}`))
  expect(kinds(W.agentLogOf(file, true))).toEqual(['said:Starting.', 'c1', 'thought:Hmm.', 'said:One more.', 'c2'])
  expect(kinds(W.agentLogOf(file, false))).toEqual(['c1', 'c2'])
  // past the newest 14 calls: what came before its first kept call is left out
  for (let i = 3; i <= 16; i++) {
    call(data, main, `c${i}`, NOW + 100 * i)
    said(main, `after c${i}`, NOW + 100 * i + 50, 'said', i)
  }
  const later = W.agentFileOf(data, main)
  expect(later.activity.map(one => one.id)[0]).toBe('c3')
  expect(later.words.map(one => one.text)).toEqual(Array.from({ length: 14 }, (_, i) => `after c${i + 3}`))
  expect(kinds(W.agentLogOf(later, true)).slice(0, 3)).toEqual(['c3', 'said:after c3', 'c4'])
})

test('the view keeps Activity`s pick: Calls only once picked, with their words again on `words`; anything else leaves it', () => {
  const fresh = M.defaultView2()
  expect(fresh.activityView).toBeUndefined()
  const calls = M.view2With(fresh, { activityView: 'calls' })
  expect(calls.activityView).toBe('calls')
  expect(M.view2With(calls, { activityView: 'loud' }).activityView).toBe('calls')
  expect(M.view2With(calls, { tab: 'chat' }).activityView).toBe('calls')
  expect('activityView' in M.view2With(calls, { activityView: 'words' })).toBe(false)
  expect(M.healView({ ...M.defaultView(), v2: calls }).v2.activityView).toBe('calls')
})

// ---------------------------------------------------------------------------
// The pane and the terminal.

const SURFACES = ['terminal', 'desktop'] as const

function pane(surface: 'terminal' | 'desktop', bodyColumns = 84) {
  return {
    plugin: 'apiarius',
    surface,
    component: 'Pane' as const,
    requestId: 'apiarius',
    viewport: { columns: bodyColumns + 4, rows: 400, isFullscreen: true },
    props: { title: 'Apiarius', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} },
  }
}

type Node = { key?: string; type?: string; props: Record<string, unknown>; text: string; children?: unknown[] }

/** The elements under `node` whose tag is `type`, in document order. */
function typed(node: { children?: unknown[] } | undefined, type: string): Node[] {
  const found: Node[] = []
  const walk = (list: unknown[]) => {
    for (const one of list) {
      if (!one || typeof one !== 'object') continue
      if ((one as Node).type === type) found.push(one as Node)
      walk((one as Node).children ?? [])
    }
  }
  walk(node?.children ?? [])
  return found
}
type Drawing = {
  press: (target: { key: string }) => Promise<unknown>
  redraw: () => Promise<void>
  find: (q: { key: string }) => Promise<Node | undefined>
  findAll: (q: { type: string }) => Promise<Node[]>
  drawn: () => Promise<unknown>
  unmount: () => Promise<void>
}

async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

/** A drawing's elements (every element and every string), its depth and its characters, as the desktop counts them. */
function sizeOf(node: unknown): { nodes: number; depth: number; chars: number } {
  if (node === null || node === undefined || typeof node === 'boolean') return { nodes: 0, depth: 0, chars: 0 }
  if (typeof node !== 'object') return { nodes: 1, depth: 1, chars: String(node).length }
  const kids = ((node as { children?: unknown[] }).children ?? []).map(sizeOf)
  return { nodes: 1 + kids.reduce((sum, one) => sum + one.nodes, 0), depth: 1 + Math.max(0, ...kids.map(one => one.depth)), chars: JSON.stringify(node).length }
}

/** `/apiarius demo` over the sample as the engine builds it, `change` laid over its state and `files` over its agent files. */
async function demo($: Engine, on: On, change: (state: W.WebStateV2) => W.WebStateV2 = state => state, files: Record<string, W.V2AgentFile> = {}) {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const session = v2Session()
  const state = change(W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable))
  const agentFiles = new Map(W.agentFilesOf(session.data).map(one => [one.id, one.text]))
  for (const [id, file] of Object.entries(files)) agentFiles.set(id, JSON.stringify(file))
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
  return { state }
}

/** builder between its calls: at work, no call in flight, its words since its latest one. */
function between(state: W.WebStateV2): W.WebStateV2 {
  return {
    ...state,
    needs: state.needs.filter(need => need.agent !== IDS.builder),
    agents: state.agents.map(row => (row.row === 'agent' && row.id === IDS.builder ? { ...row, status: 'running' as const, needs: 0, live: null, said: { text: "The tests share one Redis mock that's never reset.", at: state.now - 40_000 } } : row)),
  }
}

/** The entries an agent page's log draws, by their rows' keys: `page:call:<id>`, `page:said:…`, `page:thought:…`. */
async function entriesOf(ui: Drawing): Promise<string[]> {
  return (await ui.findAll({ type: 'Box' })).map(one => one.key ?? '').filter(key => /^page:(call|said|thought):/.test(key))
}

test('the pane and the terminal: builder`s Activity lays its words and its thought between its calls, newest first, under Calls only · With their words; Calls only leaves them out and the view keeps it', async ($, on) => {
  await demo($, on)
  for (const surface of SURFACES) {
    const ui = (await $.ui.mount(pane(surface))) as unknown as Drawing
    await press(ui, W.agentKeyOf(IDS.builder))
    if (!(await ui.find({ key: 'page:log' }))) await press(ui, 'page:fold:activity')
    // 5 calls, 7 words and a thought, newest first, as the web's drawer lists them; its head counts the calls
    expect((await ui.find({ key: 'page:fold:activity' }))?.props.label).toBe('▾ ACTIVITY')
    expect((await ui.find({ key: 'page:activity' }))?.text).toContain('5 tool calls')
    expect((await entriesOf(ui)).length).toBe(13)
    expect((await ui.find({ key: 'page:words:calls' }))?.props).toMatchObject({ label: 'Calls only', plain: true, dimColor: true })
    expect((await ui.find({ key: 'page:words:with' }))?.props).toMatchObject({ label: 'With their words', plain: true, dimColor: false })
    const log = (await ui.find({ key: 'page:log' }))?.text ?? ''
    // each call by its own description, else its target
    const order = ['“Nothing there yet.', 'rateLimit.ts', '“The limiter is in.', 'src/app.ts', '“Both stores pass', 'Push the limiter', `${THOUGHT_WORD}  Auto mode refused`, "“I won't push.", 'bench.js', '“Running the limiter tests', 'Run the limiter tests'].reverse()
    const at = order.map(words => log.indexOf(words))
    expect(at.every(one => one >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(log).toContain('⊘ denied')
    // the thought carries no label of its own: Activity says once, under its head, that thinking may be a summary
    expect(log).not.toContain('Thinking, as Claude Code shows it')
    expect(((await ui.find({ key: 'page:activity' }))?.text ?? '').split(THOUGHT_NOTE).length - 1).toBe(1)
    // where Svg draws, a speech bubble before each word and a cloud before the thought; the terminal's own marks
    if (surface === 'desktop') {
      const marks = (await ui.findAll({ type: 'Svg' })).map(one => one.props.alt).filter(alt => alt === 'Said' || alt === 'Thinking')
      expect([marks.filter(alt => alt === 'Said').length, marks.filter(alt => alt === 'Thinking').length]).toEqual([7, 1])
    } else {
      expect(log).toContain('»')
      expect(log).toContain('∴')
    }
    // the words are italic Text of their own
    const italics = (await ui.findAll({ type: 'Text' })).filter(one => one.props.italic === true && one.text.includes('Both stores pass'))
    expect(italics.length).toBeGreaterThan(0)
    await press(ui, 'page:words:calls')
    expect((await entriesOf(ui)).length).toBe(5)
    const calls = (await ui.find({ key: 'page:log' }))?.text ?? ''
    expect([calls.includes('Nothing there yet'), calls.includes(`${THOUGHT_WORD}  `), calls.includes('Push the limiter')]).toEqual([false, false, true])
    expect((await ui.find({ key: 'page:activity' }))?.text).not.toContain(THOUGHT_NOTE)
    expect((await ui.find({ key: 'page:words:calls' }))?.props.dimColor).toBe(false)
    // the pick stays for the next page
    await press(ui, 'key:b')
    await press(ui, W.agentKeyOf(IDS.builder))
    expect((await entriesOf(ui)).length).toBe(5)
    await press(ui, 'page:words:with')
    expect((await entriesOf(ui)).length).toBe(13)
    await press(ui, 'key:b')
    await ui.unmount()
  }
})

test('the pane and the terminal: an agent at work with no call in flight shows its words on its card and its page, in italics after a speech mark; Recent activity says what the agents said', async ($, on) => {
  await demo($, on, between)
  for (const surface of SURFACES) {
    const ui = (await $.ui.mount(pane(surface))) as unknown as Drawing
    const card = (await ui.find({ key: `card:${IDS.builder}` }))?.text ?? ''
    expect(card).toContain('“The tests share one Redis')
    expect(card).not.toContain('npm test')
    const words = (await ui.findAll({ type: 'Text' })).filter(one => one.props.italic === true && one.text.includes('The tests share'))
    expect(words.length).toBeGreaterThan(0)
    const recent = (await ui.find({ key: 'now:calls' }))?.text ?? ''
    expect(recent).toContain('said')
    expect(recent).toContain('“Running the limiter tests')
    expect(recent).toContain('“Checking the window math')
    await press(ui, W.agentKeyOf(IDS.builder))
    expect((await ui.find({ key: 'page:said' }))?.text).toMatch(/“The tests share one Redis mock that's never reset\.” {2}(now|1m)/)
    expect(await ui.find({ key: 'page:live' })).toBeUndefined()
    await press(ui, 'key:b')
    await ui.unmount()
  }
})

test('words with Markdown: a line of them quoted in italics, the marks dropped; more lines as Chat draws a message, its Markdown, unquoted; a thought after "thinking", its marks dropped; the page`s live line and the card drop the marks too', async ($, on) => {
  const session = v2Session()
  const builder = M.agentOf(session.data, IDS.builder)!
  const file = W.agentFileOf(session.data, builder)
  const first = file.activity[0]!
  const at = first.at
  const md: W.V2AgentFile = {
    ...file,
    activity: [first],
    words: [
      { kind: 'said', at: at + 1000, step: 1, text: 'Yes, your read is right. **PEL = the pending entries list**, see [the docs](https://redis.io).', after: first.id },
      { kind: 'said', at: at + 2000, step: 2, text: 'Here is the fix:\n\n```js\nconst limit = 10\n```\n\n- **one** store', after: first.id },
      { kind: 'thought', at: at + 3000, step: 3, text: '**Weighing the stores**\n\nThe mock is shared.', after: first.id },
    ],
  }
  const live = (state: W.WebStateV2): W.WebStateV2 => {
    const next = between(state)
    return { ...next, agents: next.agents.map(row => (row.row === 'agent' && row.id === IDS.builder ? { ...row, said: { text: 'Yes, your read is right.\n\n**PEL = …**', at: state.now - 40_000 } } : row)) }
  }
  await demo($, on, live, { [W.webIdOf(IDS.builder)]: md })
  for (const surface of SURFACES) {
    const ui = (await $.ui.mount(pane(surface))) as unknown as Drawing
    // the card: its words quoted on one line, no marks
    const card = (await ui.find({ key: `card:${IDS.builder}` }))?.text ?? ''
    expect(card).toContain('PEL = …')
    expect(card).not.toContain('**')
    await press(ui, W.agentKeyOf(IDS.builder))
    // the live line: more than one line, so unquoted; no marks
    const said = (await ui.find({ key: 'page:said' }))?.text ?? ''
    expect(said).toMatch(/^.?Yes, your read is right\.\n\nPEL = …/)
    expect(said).not.toMatch(/[“”*]/)
    if (!(await ui.find({ key: 'page:log' }))) await press(ui, 'page:fold:activity')
    // the log's rows by their keys, newest first (the sample's times are moved to now as it is read)
    const rows = (await ui.findAll({ type: 'Box' })).filter(one => /^page:(said|thought):/.test(one.key ?? ''))
    expect(rows.map(one => (one.key ?? '').split(':')[1])).toEqual(['thought', 'said', 'said'])
    const [thought, lines, line] = rows
    // one line: quoted in italics, the marks dropped
    expect(line?.text).toMatch(/^.?“Yes, your read is right\. PEL = the pending entries list, see the docs\.”/)
    expect(typed(line, 'Markdown')).toEqual([])
    expect(typed(line, 'Text').some(one => one.props.italic === true)).toBe(true)
    // more lines: Chat's Markdown, unquoted, the fence and the list kept for it to draw
    const marks = typed(lines, 'Markdown')
    expect(marks.length).toBe(1)
    // cut at a few rows inside its fence: the fence closed
    expect(String(marks[0]?.props.text)).toBe('Here is the fix:\n\n```js\nconst limit = 10\n```')
    expect(String(marks[0]?.props.text)).not.toContain('“')
    // the thought: "thinking", then its words, the marks dropped
    expect(thought?.text).toContain(`${THOUGHT_WORD}  Weighing the stores\n\nThe mock is shared.`)
    expect(thought?.text).not.toContain('**')
    await press(ui, 'key:b')
    await ui.unmount()
  }
})

test('a log too long for the pane: its newest 40 entries with "and n more", each word cut to a few rows; the drawing under 2000 elements, depth 32 and 262,144 characters', async ($, on) => {
  const session = v2Session()
  const builder = M.agentOf(session.data, IDS.builder)!
  const file = W.agentFileOf(session.data, builder)
  const long = 'A long thought about the limiter and its stores, said again and again. '.repeat(60)
  const big: W.V2AgentFile = {
    ...file,
    activity: Array.from({ length: 14 }, (_, i) => ({ id: `toolu_big${i}`, at: SAMPLE_NOW - (30 - i) * 60_000, tool: 'Read', target: `src/file${i}.ts`, ok: true, ms: 120 })),
    words: Array.from({ length: 60 }, (_, i) => ({ kind: i % 3 === 0 ? ('thought' as const) : ('said' as const), at: SAMPLE_NOW - (30 - Math.floor(i / 4)) * 60_000, step: i, text: long, after: `toolu_big${Math.floor(i / 4) % 14}`, isCut: true as const })),
  }
  await demo($, on, state => state, { [W.webIdOf(IDS.builder)]: big })
  for (const surface of SURFACES) {
    const ui = (await $.ui.mount(pane(surface))) as unknown as Drawing
    await press(ui, W.agentKeyOf(IDS.builder))
    if (!(await ui.find({ key: 'page:log' }))) await press(ui, 'page:fold:activity')
    // 14 calls and 60 words: the newest 40, its head saying the file keeps the newest 14 calls
    expect((await ui.find({ key: 'page:activity' }))?.text).toContain('the newest 14')
    expect((await entriesOf(ui)).length).toBe(40)
    expect((await ui.findAll({ type: 'Text' })).some(one => one.text === 'and 34 more')).toBe(true)
    const size = sizeOf(await ui.drawn())
    expect(size.nodes).toBeLessThan(2000)
    expect(size.depth).toBeLessThan(32)
    expect(size.chars).toBeLessThan(262_144)
    await press(ui, 'key:b')
    await ui.unmount()
  }
})
