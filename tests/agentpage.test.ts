/**
 * An agent's page on the pane and the terminal, as the web page's drawer
 * lays it out: its head and facts, Message and Chat with, its result and
 * when it came, its Activity newest first (a row a call: its tool's chip,
 * its own description else its target, how it went, when; each opening on
 * all of it), its Edits by file (the newest open on its newest edit, its
 * diff numbered on a desktop), each edit and the call that made it a press
 * apart, and the composer at its foot. Drawn by `/apiarius demo` over the v2
 * sample, and the pieces by themselves.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { hunksOf } from '../hooks/diff'
import * as M from '../hooks/model'
import { pathParts } from '../hooks/ui/v2/changes'
import { numberedRowsOf } from '../hooks/ui/v2/diffs'
import { activityNoteOf, agoText, callTextOf, logShownOf, outcomeOf, ownEditsOf } from '../hooks/ui/v2/page'
import { P } from '../hooks/ui/v2/palette'
import * as W from '../hooks/web'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { deck, newWorld, world, type World } from './world'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane(surface: Surface, bodyColumns = 84) {
  return {
    plugin: 'apiarius',
    surface,
    component: 'Pane' as const,
    requestId: 'apiarius',
    viewport: { columns: bodyColumns + 4, rows: 400, isFullscreen: true },
    props: { title: 'Apiarius', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} },
  }
}

type Node = { type?: string; key?: string; text: string; props: Record<string, unknown>; children?: unknown[] }
type Drawing = {
  press: (target: { key: string }) => Promise<unknown>
  input: (target: { key: string; text: string }) => Promise<unknown>
  redraw: () => Promise<void>
  find: (q: { key?: string; type?: string }) => Promise<Node | undefined>
  findAll: (q: { type: string }) => Promise<Node[]>
  drawn: () => Promise<unknown>
  unmount: () => Promise<void>
}

/** A press, then the drawing as the pane draws it next. */
async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

/** The keys of the elements of `type` a drawing holds, in document order, that start with `prefix`. */
async function keysOf(ui: Drawing, prefix: string, type = 'Button'): Promise<string[]> {
  return (await ui.findAll({ type })).map(one => one.key ?? '').filter(key => key.startsWith(prefix))
}

/** Agent `id`'s page, opened from the Dashboard (a finished one from behind "N finished ▸"). */
async function openPage(ui: Drawing, id: string) {
  if (!(await ui.find({ key: W.agentKeyOf(id) })) && String((await ui.find({ key: 'finished:now:fold' }))?.props.label).endsWith('▸')) await press(ui, 'finished:now:fold')
  await press(ui, W.agentKeyOf(id))
}

/** A drawing's elements (every element and every string) and its depth, as the desktop counts them. */
function sizeOf(node: unknown): { nodes: number; depth: number } {
  if (node === null || node === undefined || typeof node === 'boolean') return { nodes: 0, depth: 0 }
  if (typeof node !== 'object') return { nodes: 1, depth: 1 }
  const kids = ((node as { children?: unknown[] }).children ?? []).map(sizeOf)
  return { nodes: 1 + kids.reduce((sum, one) => sum + one.nodes, 0), depth: 1 + Math.max(0, ...kids.map(one => one.depth)) }
}

/** What a test lays over the sample: its state changed, agent files and patches of its own. */
type Over = { change?: (state: W.WebStateV2) => W.WebStateV2; agents?: Record<string, W.V2AgentFile>; patches?: Record<string, string> }

/** `/apiarius demo` over the v2 sample as the engine builds it: its state, its agent files and its patches, `over` laid over them. */
async function demo($: Engine, on: On, w: World = newWorld(), over: Over = {}) {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const session = v2Session()
  const built = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const state = over.change ? over.change(built) : built
  const agentFiles = new Map(W.agentFilesOf(session.data).map(one => [one.id, one.text]))
  for (const [id, file] of Object.entries(over.agents ?? {})) agentFiles.set(id, JSON.stringify(file))
  const patches = new Map([...session.data.edits.map(edit => [W.webIdOf(edit.id), edit.patch] as const), ...Object.entries(over.patches ?? {})])
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(state) }
    const agent = /\/web\/fixtures\/v2\/agents\/([^/]+)\.json$/.exec(path)?.[1]
    if (agent && agentFiles.has(agent)) return { value: agentFiles.get(agent)! }
    const patch = /\/web\/fixtures\/v2\/patches\/([^/]+)\.diff$/.exec(path)?.[1]
    if (patch && patches.has(patch)) return { value: patches.get(patch)! }
    return { deny: 'no such file' }
  })
  on('ui.focus', () => ({}))
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  return { session, state, w }
}

/** An agent's own file in the sample, as the deck writes it. */
function fileOf(id: string): W.V2AgentFile {
  const session = v2Session()
  return W.agentFileOf(session.data, M.agentOf(session.data, id)!)
}

test('the page`s pieces: a result`s age as the web says it; Activity`s note; a call by its own description, else its target; how it went; its log newest first, the newest 40; a diff`s lines numbered on both sides; a path as its folder and its name; its own edits', () => {
  expect([agoText(SAMPLE_NOW - 4 * 3_600_000, SAMPLE_NOW), agoText(SAMPLE_NOW - 10_000, SAMPLE_NOW), agoText(0, SAMPLE_NOW)]).toEqual(['4h ago', 'just now', ''])
  expect([activityNoteOf(0), activityNoteOf(1), activityNoteOf(3), activityNoteOf(14)]).toEqual(['', '1 tool call', '3 tool calls', 'the newest 14'])
  expect(callTextOf({ tool: 'PowerShell', target: 'Run the FizzBuzz stats script', description: 'Run the FizzBuzz stats script' })).toBe('Run the FizzBuzz stats script')
  expect(callTextOf({ tool: 'Write', target: 'src/a.ts' })).toBe('src/a.ts')
  expect(callTextOf({ tool: 'TodoWrite', target: '' })).toBe('TodoWrite')
  const state = { activity: [{ id: 'c1', at: 0, agent: 'a', agentName: 'a', tool: 'Bash', text: '', ok: false, ms: 9, refused: 'denied' as const }] }
  expect(outcomeOf(state, { status: 'done' }, { id: 'c1', ok: false, ms: 9 })).toEqual({ text: '⊘ denied', hue: P.failText })
  expect(outcomeOf(state, { status: 'waiting' }, { id: 'c2', ok: null, ms: null }).text).toBe('‖ waiting')
  expect(outcomeOf(state, { status: 'running' }, { id: 'c2', ok: null, ms: null }).text).toBe('◐ running')
  expect(outcomeOf(state, { status: 'done' }, { id: 'c2', ok: null, ms: null }).text).toBe('—')
  expect(outcomeOf(state, { status: 'done' }, { id: 'c2', ok: false, ms: 900 }).text).toBe('✕ failed')
  expect(outcomeOf(state, { status: 'done' }, { id: 'c2', ok: true, ms: 2400 }).text).toBe('2.4s')
  expect(outcomeOf(state, { status: 'done' }, { id: 'c2', ok: true, ms: null }).text).toBe('ok')
  // builder's log: the web drawer's order, newest first, its words after the call they followed
  const builder = fileOf(IDS.builder)
  const { shown, more } = logShownOf(builder, true)
  expect(shown.map(entry => (entry.kind === 'call' ? entry.call.id : entry.kind))).toEqual(W.agentLogOf(builder, true).map(entry => (entry.kind === 'call' ? entry.call.id : entry.kind)).reverse())
  expect(more).toBe(0)
  const many = { activity: Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, at: i, tool: 'Read', target: `f${i}`, ok: true, ms: 1 })) }
  const cut = logShownOf(many, false)
  expect([cut.shown.length, cut.more, cut.shown[0]?.kind === 'call' ? cut.shown[0].call.id : '']).toEqual([40, 10, 'c49'])
  // a hunk's lines numbered, the old side from its start, the new from its own; a new file's on the new side alone
  const rows = numberedRowsOf(hunksOf('@@ -1,3 +1,4 @@\n import { auth } from "./auth"\n+import { limiter } from "./rateLimit"\n app.use(auth())\n-app.use(routes)\n+app.use(limit(limiter(store)), routes)\n'))
  expect(rows.map(row => [row.kind, row.old, row.new])).toEqual([
    ['hunk', '', ''],
    ['same', '1', '1'],
    ['add', '', '2'],
    ['same', '2', '3'],
    ['del', '3', ''],
    ['add', '', '4'],
  ])
  expect(numberedRowsOf(hunksOf('@@ -0,0 +1,2 @@\n+a\n+\tb\n')).map(row => [row.new, row.text])).toEqual([['', '@@ -0,0 +1,2 @@'], ['1', 'a'], ['2', '  b']])
  expect([pathParts('C:/Users/sam/AppData/Local/Temp/bench.js'), pathParts('src\\app.ts'), pathParts('README.md')]).toEqual([
    { dir: 'C:/Users/sam/AppData/Local/Temp/', base: 'bench.js' },
    { dir: 'src\\', base: 'app.ts' },
    { dir: '', base: 'README.md' },
  ])
  // its own edits as its file lists them; with no file, the state's of it
  const session = v2Session()
  const v2 = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  expect(ownEditsOf(v2, { id: IDS.tester }, fileOf(IDS.tester)).map(edit => edit.id)).toEqual(['toolu_01TstW1', 'toolu_01TstE1'])
  expect(ownEditsOf(v2, { id: IDS.tester }, null).map(edit => edit.id)).toEqual(['toolu_01TstW1', 'toolu_01TstE1'])
})

test('tester`s page, as the web`s drawer: its head and facts, Back at the right; RESULT and how long ago it came; Activity newest first, a row a call that opens on all of it; Edits a file a row, the one edited last open on its diff', async ($, on) => {
  await demo($, on)
  const file = fileOf(IDS.tester)
  const bash = file.activity.find(call => call.tool === 'Bash')!
  for (const surface of SURFACES) {
    const ui = (await $.ui.mount(pane(surface))) as unknown as Drawing
    await openPage(ui, IDS.tester)
    const head = (await ui.find({ key: 'page:head' }))?.text ?? ''
    expect(head).toContain('tester')
    expect(head).toContain('general-purpose · haiku-4.5')
    expect((await ui.find({ key: 'page:facts' }))?.text).toMatch(/● done.*started by.*builder.*76\.9k tokens.*c4d7e8f/s)
    // its result, and when it handed it back, as the web's "RESULT 4h ago"
    expect((await ui.find({ key: 'page:result' }))?.text).toMatch(/^RESULT {2}(\d+[mhd] ago|just now)Wrote 6 tests/)
    // Activity: its note the calls counted, its rows newest first, each by its own description
    expect((await ui.find({ key: 'page:activity' }))?.text).toContain(activityNoteOf(file.activity.length))
    expect(await keysOf(ui, 'page:act:')).toEqual(file.activity.map(call => `page:act:${call.id}`).reverse())
    expect((await ui.find({ key: `page:act:${bash.id}` }))?.props.label).toBe('Run the limiter tests')
    // how long it took and when, at the row's right
    expect((await ui.find({ key: `page:call:${bash.id}` }))?.text).toMatch(/Run the limiter tests.*1m/)
    // a row opens on all of it: its command, its id, how it went
    expect((await ui.find({ key: `page:call:${bash.id}` }))?.text).not.toContain('npm test -- rateLimit --runInBand')
    await press(ui, `page:act:${bash.id}`)
    const open = (await ui.find({ key: `page:call:${bash.id}` }))?.text ?? ''
    expect(open).toContain('npm test -- rateLimit --runInBand')
    expect(open).toContain(`${bash.id} · `)
    expect((await ui.findAll({ type: 'Code' })).some(code => code.props.language === 'bash')).toBe(true)
    await press(ui, `page:act:${bash.id}`)
    // Edits: a file a row, the one edited last first and open on its newest edit, the other shut
    expect(await keysOf(ui, 'page:edits:')).toEqual(['page:edits:src/rateLimit.ts', 'page:edits:tests/rateLimit.test.ts'])
    expect((await ui.find({ key: 'page:edits' }))?.text).toContain('2 files')
    expect((await ui.find({ key: 'page:edits:src/rateLimit.ts' }))?.props).toMatchObject({ label: 'rateLimit.ts', plain: true })
    expect((await ui.find({ key: 'page:editrow:src/rateLimit.ts' }))?.text).toMatch(/src\/.*rateLimit\.ts.*1 edit/s)
    expect(await keysOf(ui, 'edit:', 'Box')).toEqual(['edit:toolu_01TstE1'])
    expect((await ui.find({ key: 'edit:toolu_01TstE1' }))?.text).toContain('(await store.hit(key, now)) <= perMinute')
    // the one edit of its file shows its diff, with no head to press and no Show diff
    expect([...(await keysOf(ui, 'page:edithead:')), ...(await keysOf(ui, 'row:page:edithead:'))]).toEqual([])
    await press(ui, 'page:edits:tests/rateLimit.test.ts')
    expect(await keysOf(ui, 'edit:', 'Box')).toEqual(['edit:toolu_01TstE1', 'edit:toolu_01TstW1'])
    expect((await ui.find({ key: 'edit:toolu_01TstW1' }))?.text).toContain('a burst past the limit is refused')
    await press(ui, 'page:edits:tests/rateLimit.test.ts')
    await press(ui, 'key:b')
    await ui.unmount()
  }
})

test('an edit and the call that made it are a press apart: "↑ In Activity" opens its call, "↓ In Edits" opens its file on its diff; an edit`s diff numbered on a desktop (the engine`s own block on the terminal), the drawing inside the desktop`s bounds', async ($, on) => {
  await demo($, on)
  for (const surface of SURFACES) {
    const ui = (await $.ui.mount(pane(surface))) as unknown as Drawing
    await openPage(ui, IDS.tester)
    // the edit's head: its tool's chip, when, its lines, and the way to its call
    expect((await ui.find({ key: 'page:tocall:toolu_01TstE1' }))?.props).toMatchObject({ label: '↑ In Activity', plain: true, dimColor: true })
    expect((await ui.find({ key: 'page:call:toolu_01TstE1' }))?.text).not.toContain('toolu_01TstE1 · ')
    await press(ui, 'page:tocall:toolu_01TstE1')
    expect((await ui.find({ key: 'page:call:toolu_01TstE1' }))?.text).toContain('toolu_01TstE1 · ')
    // the call shows its edit too, and the way back to it
    expect((await ui.find({ key: 'page:toedit:toolu_01TstE1' }))?.props).toMatchObject({ label: '↓ In Edits' })
    await press(ui, 'page:act:toolu_01TstE1')
    // a call whose file is shut: "↓ In Edits" opens it on that edit's diff
    await press(ui, 'page:act:toolu_01TstW1')
    expect(await keysOf(ui, 'edit:', 'Box')).toEqual(['edit:toolu_01TstE1'])
    await press(ui, 'page:toedit:toolu_01TstW1')
    expect(await keysOf(ui, 'edit:', 'Box')).toEqual(['edit:toolu_01TstE1', 'edit:toolu_01TstW1'])
    expect((await ui.find({ key: 'edit:toolu_01TstW1' }))?.text).toContain('a burst past the limit is refused')
    if (surface === 'desktop') {
      // numbered as the web numbers it, in the monospaced face: no Code block of the engine's
      const lines = (await ui.findAll({ type: 'Text' })).filter(one => one.props.mono === true)
      expect(lines.some(one => /^\s*1 \+ import \{ limiter \}/.test(one.text))).toBe(true)
      expect((await ui.findAll({ type: 'Code' })).filter(code => code.props.format === 'diff')).toEqual([])
    } else {
      expect((await ui.findAll({ type: 'Code' })).filter(code => code.props.format === 'diff').length).toBeGreaterThan(0)
    }
    const size = sizeOf(await ui.drawn())
    expect(size.nodes).toBeLessThan(2000)
    expect(size.depth).toBeLessThan(32)
    // as it was, for the next surface
    await press(ui, 'page:act:toolu_01TstW1')
    await press(ui, 'page:edits:tests/rateLimit.test.ts')
    await press(ui, 'key:b')
    await ui.unmount()
  }
})

test('Edits opens a file from anywhere on its row, and among several edits of a file an edit`s diff from anywhere on its head but its links: the terminal`s row and head one Button, a desktop`s a veil over them; "↑ In Activity" keeps its own press', async ($, on) => {
  // tester's two edits, of one file here: an edit among several shows or hides its diff
  await demo($, on, newWorld(), {
    change: state => ({ ...state, changes: { ...state.changes, edits: state.changes.edits.map(edit => (edit.id === 'toolu_01TstW1' ? { ...edit, path: 'src/rateLimit.ts' } : edit)) } }),
  })
  const file = 'src/rateLimit.ts'
  for (const surface of SURFACES) {
    const ui = (await $.ui.mount(pane(surface))) as unknown as Drawing
    await openPage(ui, IDS.tester)
    const rowKey = surface === 'terminal' ? `page:edits:${file}` : `row:page:edits:${file}`
    if (surface === 'terminal') {
      // the file's row one Button: its chevron, folder, name, count and lines
      expect((await ui.find({ key: `page:edits:${file}` }))?.text).toBe((await ui.find({ key: `page:editrow:${file}` }))?.text)
      expect((await ui.find({ key: `page:edits:${file}` }))?.text).toMatch(/^[▸▾] src\/rateLimit\.ts 2 edits \+\d+/)
      expect(await ui.find({ key: `row:page:edits:${file}` })).toBeUndefined()
    } else {
      expect((await ui.find({ key: `page:edits:${file}` }))?.props).toMatchObject({ label: 'rateLimit.ts', plain: true })
      expect(String((await ui.find({ key: rowKey }))?.props.label).trim()).toBe('')
    }
    // the file's row, pressed anywhere: shut, then open again
    const isOpenNow = async () => (await keysOf(ui, 'edit:', 'Box')).length > 0
    const wasOpen = await isOpenNow()
    await press(ui, rowKey)
    expect(await isOpenNow()).toBe(!wasOpen)
    if (!(await isOpenNow())) await press(ui, rowKey)
    expect(await keysOf(ui, 'edit:', 'Box')).toEqual(['edit:toolu_01TstE1', 'edit:toolu_01TstW1'])
    // an edit's head among several: a press on it shows or hides its diff, as Show diff does
    const headKey = surface === 'terminal' ? 'page:edithead:toolu_01TstW1' : 'row:page:edithead:toolu_01TstW1'
    const shown = String((await ui.find({ key: 'page:diff:toolu_01TstW1' }))?.props.label)
    expect(['Show diff', 'Hide diff']).toContain(shown)
    await press(ui, headKey)
    expect((await ui.find({ key: 'page:diff:toolu_01TstW1' }))?.props.label).toBe(shown === 'Show diff' ? 'Hide diff' : 'Show diff')
    await press(ui, headKey)
    expect((await ui.find({ key: 'page:diff:toolu_01TstW1' }))?.props.label).toBe(shown)
    if (surface === 'terminal') expect((await ui.find({ key: headKey }))?.text).toMatch(/^ Write +\S+ \+\d+/)
    // the veil lies over its chip, when and lines alone: its links stand beside it, and keep their own press
    if (surface === 'desktop') {
      const head = (await ui.find({ key: 'edit:toolu_01TstW1' })) as unknown as { children: { children: { children: { props: Record<string, unknown> }[] }[] }[] }
      const [left, right] = head.children[0]!.children
      expect(left!.children.at(-1)?.props).toMatchObject({ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 })
      expect(JSON.stringify(right)).toContain('page:tocall:toolu_01TstW1')
    }
    const isCallOpen = async () => ((await ui.find({ key: 'page:call:toolu_01TstW1' }))?.text ?? '').includes('toolu_01TstW1 · ')
    if (await isCallOpen()) await press(ui, 'page:act:toolu_01TstW1')
    await press(ui, 'page:tocall:toolu_01TstW1')
    expect(await isCallOpen()).toBe(true)
    await press(ui, 'page:act:toolu_01TstW1')
    await press(ui, 'key:b')
    await ui.unmount()
  }
})

test('the page`s foot: a composer whose words go to its agent (in the sample, none goes, and it says so); Message takes the focus to it, Chat with opens Chat with it picked', async ($, on) => {
  const { w } = await demo($, on)
  for (const surface of SURFACES) {
    const ui = (await $.ui.mount(pane(surface))) as unknown as Drawing
    await openPage(ui, IDS.tester)
    expect((await ui.find({ type: 'Input' }))?.props).toMatchObject({ placeholder: 'Message tester…', submitLabel: 'Send', value: '' })
    const foot = (await ui.find({ key: 'page:compose' }))?.text ?? ''
    expect(foot).toContain('→ tester via SendMessage')
    expect(foot).toContain('Sample data: nothing is sent.')
    await ui.input({ key: (await ui.find({ type: 'Input' }))?.key ?? '', text: 'Run them once more.' })
    expect(w.toasts.at(-1)).toBe('Sample data: nothing is sent. Back to this chat to talk to your agents.')
    // the words stay in the sample
    await ui.redraw()
    expect((await ui.find({ type: 'Input' }))?.props.value).toBe('Run them once more.')
    await ui.input({ key: (await ui.find({ type: 'Input' }))?.key ?? '', text: '' })
    expect((await ui.find({ key: 'page:message' }))?.props).toMatchObject({ label: 'Message', plain: true })
    await press(ui, 'page:chatwith')
    expect(await ui.find({ key: 'page:head' })).toBeUndefined()
    expect((await ui.find({ key: `chat:filter:${IDS.tester}` }))?.props.dimColor).toBe(false)
    await press(ui, 'chat:filter:all')
    await press(ui, 'tab:now')
    await ui.unmount()
  }
  // the Orchestrator's page: its latest answer, its words go to it as your next prompt
  const ui = (await $.ui.mount(pane('terminal'))) as unknown as Drawing
  await press(ui, W.agentKeyOf(M.MAIN))
  expect((await ui.find({ key: 'page:head' }))?.text).toContain('main loop · opus-5.5')
  expect((await ui.find({ key: 'page:result' }))?.text).toMatch(/^LATEST ANSWER/)
  // its own composer, under the field a question of its holds for its Other
  expect((await ui.findAll({ type: 'Input' })).find(one => (one.key ?? '').startsWith('page:composer:'))?.props.placeholder).toBe('Message the Orchestrator…')
  expect((await ui.find({ key: 'page:compose' }))?.text).toMatch(/→ Orchestrator: (your next prompt|Claude reads it when it finishes its current turn)/)
  await ui.unmount()
})

test('a page with every part open stays inside the desktop`s bounds: 14 calls each an edit of its own file of 60 lines, every call and every file open; the numbered rows give way to the engine`s diff block once the drawing`s budget is spent', async ($, on) => {
  const builder = fileOf(IDS.builder)
  const at = SAMPLE_NOW - 30 * 60_000
  const calls = Array.from({ length: 14 }, (_, i) => ({ id: `toolu_wide${i}`, at: at + i * 60_000, tool: 'Write', target: `src/part${i}.ts`, ok: true, ms: 120 }))
  const patch = (i: number) => `--- /dev/null\n+++ b/src/part${i}.ts\n@@ -0,0 +1,60 @@\n${Array.from({ length: 60 }, (_, n) => `+export const line${n} = ${n} // part ${i}`).join('\n')}\n`
  const over: Over = {
    agents: { [W.webIdOf(IDS.builder)]: { ...builder, activity: calls, words: [], edits: calls.map(call => call.id) } },
    patches: Object.fromEntries(calls.map((call, i) => [call.id, patch(i)])),
    change: state => ({ ...state, changes: { ...state.changes, edits: [...state.changes.edits.filter(edit => edit.agent !== IDS.builder), ...calls.map(call => ({ id: call.id, agent: IDS.builder, tool: 'Write', path: call.target, at: call.at, added: 60, removed: 0 }))] } }),
  }
  await demo($, on, newWorld(), over)
  const ui = (await $.ui.mount(pane('desktop', 120))) as unknown as Drawing
  await press(ui, W.agentKeyOf(IDS.builder))
  // every file open (12 drawn, "2 more files"), every call open on its diff
  const rows = await keysOf(ui, 'page:edits:')
  expect(rows.length).toBe(12)
  expect((await ui.find({ key: 'page:edits' }))?.text).toContain('2 more files: Changes lists them all.')
  for (const key of rows.slice(1)) await press(ui, key)
  for (const call of calls) await press(ui, `page:act:${call.id}`)
  // the numbered rows while the budget lasts, then the engine's block
  expect((await ui.findAll({ type: 'Text' })).some(one => one.props.mono === true)).toBe(true)
  expect((await ui.findAll({ type: 'Code' })).filter(code => code.props.format === 'diff').length).toBeGreaterThan(0)
  const size = sizeOf(await ui.drawn())
  expect(size.nodes).toBeLessThan(2000)
  expect(size.depth).toBeLessThan(32)
  expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(262_144)
  await ui.unmount()
})
