import type { On, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { emptyGit, type FileRow } from '../hooks/git'
import * as M from '../hooks/model'
import { treeSize } from '../hooks/ui/common'
import { UNTOUCHED } from '../hooks/ui/outlineModel'
import { T } from '../hooks/ui/theme'
import type { DeckAgent, DeckData, DeckSnapshot } from '../types'

const HASH = 'a'.repeat(40)
const NOW = 1_700_000_100_000
const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  title: 'Agent Deck',
  isFocused: true,
  bodyColumns: 96,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

const BAND = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 8,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 8 },
  view: {},
} as const

const VIEWPORT = { columns: 100, rows: 50, isFullscreen: true }

function pane(surface: (typeof SURFACES)[number]) {
  return { plugin: 'agent-deck', surface, component: 'Pane' as const, requestId: 'agent-deck', viewport: VIEWPORT, props: PANE }
}

function band(surface: (typeof SURFACES)[number]) {
  return { plugin: 'agent-deck', surface, component: 'AbovePrompt' as const, viewport: VIEWPORT, props: BAND }
}

/** /deck as typed at the prompt, with what the engine stamps on it. */
function deck(args: string) {
  return { command: 'deck', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 100 } }
}

/** An Agent tool call's spawn, with the fields the engine fills in; the stub names the agent `agent-<name>`. */
function spawn(name: string, description: string, prompt: string) {
  return {
    tool_use_id: `toolu_${name}`,
    prompt,
    description,
    subagentType: 'Explore',
    name,
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-test',
    background: true,
    fork: false,
  }
}

/** What git prints for each command the deck runs, in a repository at /repo with two changed files. */
function gitOut(argv: readonly string[]): { exitCode: number; stdout: string } {
  const line = argv.join(' ')
  if (line.includes('rev-parse --show-toplevel')) return { exitCode: 0, stdout: '/repo\n' }
  if (line.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: 'main\n' }
  if (line.includes('rev-parse --verify --quiet HEAD')) return { exitCode: 0, stdout: `${HASH}\n` }
  if (line.includes('@{upstream}')) return { exitCode: 128, stdout: '' }
  if (line.includes('status --porcelain')) return { exitCode: 0, stdout: ' M src/app.ts\0?? notes.txt\0' }
  if (line.includes('--numstat -z HEAD')) return { exitCode: 0, stdout: '1\t1\tsrc/app.ts\0' }
  if (line.includes('rev-list --count')) return { exitCode: 0, stdout: '1\n' }
  if (line.includes(' log --since')) return { exitCode: 0, stdout: '\x1e\n 1 file changed, 2 insertions(+)\n' }
  if (line.includes(' log -n30')) return { exitCode: 0, stdout: `\x1e${HASH}\x1f${HASH.slice(0, 7)}\x1fSam\x1f1700000000\x1fFirst commit\n\n 1 file changed, 2 insertions(+)\n` }
  return { exitCode: 1, stdout: '' }
}

type Sent = { to: string; text: string }

/**
 * Answers every engine call the deck makes, in Claude Code's place. `restored`
 * is the snapshot the deck finds in `$.state` (a session already under way),
 * `messages` an agent's transcript, `opened` counts the panes it opens.
 */
function world(on: On, options: { isRepo?: boolean; messages?: SessionMessage[]; restored?: DeckSnapshot; sent?: Sent[]; opened?: string[] } = {}) {
  const isRepo = options.isRepo ?? true
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    options.opened?.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } } }))
  on('session.messages', () => ({ value: options.messages ?? [] }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', ($, e) => ({ value: { ...(isRepo ? gitOut(e.argv) : { exitCode: 128, stdout: '' }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: NOW, isLink: false } }))
  on('fs.read', () => ({ value: 'hello\nworld\n' }))
  on('session.send', ($, e) => {
    options.sent?.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', ($, e) => ({ model: 'claude-haiku', agentId: `agent-${e.name ?? 'x'}` }))
  on('tool.call', ($, e) => {
    if (e.tool === 'Edit') {
      return {
        result: {
          filePath: '/repo/src/app.ts',
          oldString: 'const b = 2',
          newString: 'const b = 3',
          originalFile: 'const a = 1\nconst b = 2\nexport { a, b }\n',
          structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' const a = 1', '-const b = 2', '+const b = 3', ' export { a, b }'] }],
          userModified: false,
          replaceAll: false,
        },
      }
    }
    return { result: 'ok' }
  })
  if (options.restored) {
    const restored = options.restored
    on('state.get', { plugin: 'agent-deck', key: 'snapshot' }, () => ({ value: { value: restored, version: 1 } }))
  }
}

const PATCH = ['@@ -1,3 +1,3 @@', ' const a = 1', '-const b = 2', '+const b = 3', ' export { a, b }'].join('\n')

function agent(data: DeckData, id: string, name: string, extra: Partial<DeckAgent>): DeckAgent {
  const made = M.newAgent(id, 'agent', name, NOW - 240_000, { type: 'general-purpose', parentId: M.MAIN, status: 'running', ...extra })
  data.agents.push(made)
  return made
}

/**
 * A session under way: you asked the Orchestrator to fix a bug, it handed the
 * fix to `fixer`, which handed a search to `helper`; fixer has edited
 * src/auth.ts and is running the tests.
 */
function busyData(): DeckData {
  const data = M.emptyData(NOW - 300_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  const fixer = agent(data, 'agent-fixer', 'fixer', { prompt: 'Fix the login bug in src/auth.ts and run the tests', description: 'Fix the login bug', model: 'claude-haiku-4-5-20251001' })
  const helper = agent(data, 'agent-helper', 'helper', { parentId: fixer.id, type: 'Explore', description: 'Find the auth module' })
  M.beginTool(data, fixer, M.activityOf('t1', 'Bash', { command: 'npm test', description: 'Run the unit tests' }, '/repo', NOW - 20_000))
  M.addEdit(data, fixer, { id: 'e1', agent: fixer.id, tool: 'Edit', path: 'src/auth.ts', abs: '/repo/src/auth.ts', at: NOW - 60_000, added: 1, removed: 1, patch: PATCH, isNew: false })
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: 'Fix the login bug', at: NOW - 300_000 })
  M.addMessage(data, { from: M.MAIN, to: fixer.id, kind: 'spawn', text: 'Fix the login bug in src/auth.ts and run the tests', at: NOW - 240_000 })
  M.addMessage(data, { from: fixer.id, to: helper.id, kind: 'spawn', text: 'Find the auth module', at: NOW - 200_000 })
  M.addMessage(data, { from: helper.id, to: fixer.id, kind: 'result', text: 'It is src/auth.ts', at: NOW - 100_000 })
  return data
}

function snapshot(data: DeckData, view: Partial<DeckSnapshot['view']> = {}): DeckSnapshot {
  return { v: M.SNAPSHOT_VERSION, data, view: { ...M.defaultView(), ...view } }
}

function fileRow(path: string): FileRow {
  return { path, code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 1, removed: 1 }
}

/** The git the stub world shows once read: a repository with two changed files. */
const GIT = { ...emptyGit(), isRepo: true, files: [fileRow('src/app.ts'), fileRow('notes.txt')] }

type Found = { type: string; key: string | undefined; props: Record<string, unknown>; text: string; children: unknown[] }
type Drawing = { findAll: (query: { type?: string }) => Promise<Found[]> }

/** The needs-you line's bar: every Box drawn with the quote border in copper. */
async function copperBars(ui: Drawing): Promise<Found[]> {
  return (await ui.findAll({ type: 'Box' })).filter(box => box.props.borderStyle === 'quote' && box.props.borderColor === T.copper)
}

/** The outline's rows, top to bottom, by the id each stands for. */
async function rowsOf(ui: Drawing): Promise<string[]> {
  return (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('row:')).map(key => key.slice('row:'.length))
}

/** The cells an outline row is indented: its fold column's left padding. */
async function indentOf(ui: Drawing, id: string): Promise<number> {
  const row = (await ui.findAll({ type: 'Box' })).find(box => box.key === `row:${id}`)
  const line = (row?.children[0] ?? {}) as { children?: { props?: Record<string, unknown> }[] }
  return Number(line.children?.[0]?.props?.paddingLeft ?? -1)
}

test('the tab row is Dashboard, Org, Changes, Stats and Classic (keys 1 to 5); Classic, the Agents tab, is one quiet line before the first prompt, on each surface', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('classic'))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'tab:dashboard' }))?.props).toMatchObject({ label: 'Dashboard', dimColor: true, hotkey: '1' })
    expect((await ui.find({ key: 'tab:org' }))?.props).toMatchObject({ label: 'Org', dimColor: true, hotkey: '2' })
    expect((await ui.find({ key: 'tab:changes' }))?.props).toMatchObject({ dimColor: true, hotkey: '3' })
    expect((await ui.find({ key: 'tab:stats' }))?.props).toMatchObject({ dimColor: true, hotkey: '4' })
    expect((await ui.find({ key: 'tab:agents' }))?.props).toMatchObject({ label: 'Classic', dimColor: false, hotkey: '5' })
    // one dim italic line where the needs-you line, the goal, the outline, Files and the detail will be
    const line = await ui.find({ type: 'Text', text: UNTOUCHED })
    expect(line?.props).toMatchObject({ dimColor: true, italic: true })
    expect((await ui.findAll({ type: 'Text' })).filter(text => text.props.italic === true)).toHaveLength(1)
    for (const text of [M.needsOf(M.emptyData(NOW), GIT).text, 'Goal', /files?$/, 'No agents yet']) expect(await ui.find({ type: 'Text', text })).toBeUndefined()
    expect(await copperBars(ui)).toEqual([])
    expect(await rowsOf(ui)).toEqual([])
    expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toEqual(['tab:dashboard', 'tab:org', 'tab:changes', 'tab:stats', 'tab:agents', 'web:open'])
    await ui.unmount()
  }
})

const NEEDS: { name: string; data: () => DeckData; isLoud: boolean }[] = [
  { name: 'nothing, while the agents work', data: busyData, isLoud: false },
  {
    name: 'a failure, on the bar',
    data: () => {
      const data = busyData()
      const fixer = M.agentOf(data, 'agent-fixer')!
      Object.assign(fixer, { status: 'failed', endedAt: NOW - 30_000, answer: 'Tests still fail in auth.spec.ts', current: undefined })
      return data
    },
    isLoud: true,
  },
  {
    name: 'a wait on you, on the bar',
    data: () => {
      const data = busyData()
      M.noteNeeds(data, { kind: 'permission_prompt', text: 'Claude needs your permission to use Bash', at: NOW - 5_000 })
      return data
    },
    isLoud: true,
  },
  {
    name: 'a question held on you ("fixer asks: …"), on the bar',
    data: () => {
      const data = busyData()
      const options = [
        { label: 'Keep', description: 'Old clients go on working' },
        { label: 'Drop', description: 'Simpler code' },
      ]
      M.notePending(data, { id: 'toolu_q', agentId: 'agent-fixer', kind: 'question', tool: 'AskUserQuestion', at: NOW - 5_000, questions: [{ question: 'Keep the old token format?', header: 'Format', multiSelect: false, options }] })
      return data
    },
    isLoud: true,
  },
  {
    name: 'a permission prompt held on you ("fixer needs your OK to run `npm test`"), on the bar',
    data: () => {
      const data = busyData()
      M.notePending(data, M.permissionOf({ id: 'toolu_p', tool: 'Bash', input: { command: 'npm test' }, agentId: 'agent-fixer', at: NOW - 5_000 }, '/repo'))
      return data
    },
    isLoud: true,
  },
]

for (const needs of NEEDS) {
  test(`the needs-you line says the one thing to notice: ${needs.name}`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const data = needs.data()
    world(on, { restored: snapshot(data) })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
    await $.command.run(deck('classic'))
    await clock.advance(1000)

    const said = M.needsOf(data, GIT, NOW)
    expect(said.tone === 'alert' || said.tone === 'attention').toBe(needs.isLoud)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      const bars = await copperBars(ui)
      if (needs.isLoud) {
        // one row behind the copper rail: the agent bold, the rest plain, and Open (n) selects it
        const lines = bars.filter(bar => bar.text.includes(said.text))
        expect(lines.length).toBe(1)
        expect(await ui.find({ type: 'Text', text: ' fixer' })).toBeDefined()
        expect((await ui.find({ key: 'needs:open' }))?.props.hotkey).toBe('n')
        await ui.press({ key: 'needs:open' })
        expect((await ui.find({ key: `agent:${said.agentId}` }))?.props.variant).toBe('primary')
        await ui.press({ key: 'agent:main' })
      } else {
        expect(bars).toEqual([])
        expect(await ui.find({ type: 'Text', text: said.text })).toBeDefined()
        expect(await ui.find({ key: 'needs:open' })).toBeUndefined()
      }
      await ui.unmount()
    }
  })
}

test('the outline: who started whom, and where each agent is, in native rows on each surface', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, { restored: snapshot(busyData()) })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('details'))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // no image and no toggle: helper one level under fixer, fixer one under the Orchestrator
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect(await ui.find({ key: 'map:wire' })).toBeUndefined()
    expect(await rowsOf(ui)).toEqual(['main', 'agent-fixer', 'agent-helper'])
    expect([await indentOf(ui, 'main'), await indentOf(ui, 'agent-fixer'), await indentOf(ui, 'agent-helper')]).toEqual([0, 2, 4])
    // what the Orchestrator waits on, and each agent's line two: its call, else its task
    expect(await ui.find({ type: 'Text', text: 'waiting on 1 agent' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Run the unit tests' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Find the auth module' })).toBeDefined()
    expect((await ui.find({ key: 'agent:agent-helper' }))?.props.label).toBe('helper')
    await ui.unmount()
  }
})

test('the summary says what each agent waits on you for, in its own row, in ochre: what it asks, or what it needs your OK for; never "allow AskUserQuestion"', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const data = busyData()
  const options = [
    { label: 'Yes', description: '' },
    { label: 'No', description: '' },
  ]
  M.notePending(data, {
    id: 'toolu_q',
    agentId: 'agent-helper',
    kind: 'question',
    tool: 'AskUserQuestion',
    at: NOW - 5_000,
    questions: [
      { question: 'Is src/auth.ts the module?', header: 'Module', multiSelect: false, options },
      { question: 'Keep its tests?', header: 'Tests', multiSelect: false, options },
    ],
  })
  M.notePending(data, M.permissionOf({ id: 'toolu_p', tool: 'Edit', input: { file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' }, agentId: 'agent-fixer', at: NOW - 4_000 }, '/repo'))
  world(on, { restored: snapshot(data) })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('classic'))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // the line leads with the one asked first; the summary counts both
    expect((await copperBars(ui)).some(bar => bar.text.includes('helper asks 2 questions'))).toBe(true)
    expect((await ui.find({ key: 'slim:step' }))?.text).toMatch(/2 waits on you/)
    for (const [id, line] of [
      ['agent-helper', 'Asks 2 questions'],
      ['agent-fixer', 'Needs your OK to edit `src/auth.ts`'],
    ] as const) {
      const row = await ui.find({ key: `slim:${id}` })
      expect(row?.text).toContain(line)
      expect((await ui.findAll({ type: 'Text', text: line })).some(text => text.props.color === T.warn)).toBe(true)
    }
    expect(await ui.find({ type: 'Text', text: /allow / })).toBeUndefined()
    await ui.unmount()
  }
})

/** The summary's rows, top to bottom, by the agent each stands for. */
async function slimRowsOf(ui: Drawing): Promise<string[]> {
  return (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => /^slim:(?!agent:|step$)/.test(key)).map(key => key.slice('slim:'.length))
}

test('the Agents tab is a summary: the needs-you line, the goal and its step, one row per agent at work, Open dashboard; Details shows the full outline', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const data = busyData()
  M.noteGoal(data, 'goal', { text: 'Fix the login bug', origin: 'composer', at: NOW - 300_000 })
  M.agentOf(data, 'agent-fixer')!.goal = data.goals[0]?.id
  M.agentOf(data, 'agent-helper')!.goal = data.goals[0]?.id
  world(on, { restored: snapshot(data) })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('classic'))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // no outline, no Files, no detail: the summary
    expect(await rowsOf(ui)).toEqual([])
    expect(await ui.find({ type: 'Text', text: 'Nothing needs you' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'Fix the login bug' }))?.props.bold).toBe(true)
    expect((await ui.find({ key: 'slim:step' }))?.text).toBe('2 running · 2 files')
    // the agents at work, each with its status, label and one line
    expect(await slimRowsOf(ui)).toEqual(['main', 'agent-fixer', 'agent-helper'])
    expect((await ui.find({ key: 'slim:agent-fixer' }))?.text).toContain('Run the unit tests')
    expect((await ui.find({ key: 'slim:agent-helper' }))?.text).toContain('Find the auth module')
    expect((await ui.find({ key: 'slim:main' }))?.text).toContain('Waiting on 1 agent')
    expect((await ui.find({ key: 'slim:agent:agent-helper' }))?.props).toMatchObject({ label: 'helper', plain: true })
    // the dashboard's button, the one primary, and Details beside it
    expect((await ui.find({ key: 'web:open' }))?.props).toMatchObject({ label: 'Open dashboard', variant: 'primary', hotkey: 'w' })
    expect((await ui.find({ key: 'agents:details' }))?.props).toMatchObject({ label: 'Details', hotkey: 'e' })
    expect((await ui.findAll({ type: 'Button' })).filter(button => button.props.variant === 'primary').map(button => button.key)).toEqual(['web:open'])

    // Details: the full outline as before, the summary's rows gone; again: the summary
    await ui.press({ key: 'agents:details' })
    expect(await rowsOf(ui)).toEqual(['main', 'agent-fixer', 'agent-helper'])
    expect(await slimRowsOf(ui)).toEqual([])
    expect((await ui.find({ key: 'agents:details' }))?.props.label).toBe('Hide details')
    expect(await ui.find({ key: 'web:open' })).toBeDefined()
    await ui.press({ key: 'agents:details' })
    expect(await rowsOf(ui)).toEqual([])

    // a row's label opens the full outline on that agent
    await ui.press({ key: 'slim:agent:agent-fixer' })
    expect((await ui.find({ key: 'agent:agent-fixer' }))?.props.variant).toBe('primary')
    await ui.press({ key: 'agents:details' })
    await ui.unmount()
  }
})

test('pressing an agent in the outline opens its detail, and Diffs shows its exact patch', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, { restored: snapshot(busyData()) })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('details'))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // each label a plain Button; the selected one, and only it, the primary plate
    for (const key of ['agent:main', 'agent:agent-fixer', 'agent:agent-helper']) {
      const props = (await ui.find({ key }))?.props
      if (props?.variant === 'primary') expect(props.plain).toBeUndefined()
      else expect(props?.plain).toBe(true)
    }
    await ui.press({ key: 'agent:agent-fixer' })
    expect((await ui.find({ key: 'agent:agent-fixer' }))?.props.plain).toBeUndefined()
    expect((await ui.find({ key: 'agent:agent-helper' }))?.props.plain).toBe(true)
    expect((await ui.find({ key: 'agent:agent-fixer' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'agent:main' }))?.props.variant).toBeUndefined()

    // its task and where it is
    for (const label of ['Task', 'Now']) expect(await ui.find({ type: 'Text', text: label })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Fix the login bug in src/auth.ts and run the tests' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Run the unit tests' })).toBeDefined()

    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(code?.text).toContain('+const b = 3')
    expect(await ui.find({ type: 'Text', text: 'auth.ts' })).toBeDefined()

    await ui.press({ key: 'detail:activity' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Bash' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'running' })).toBeDefined()
    await ui.press({ key: 'detail:edits' })

    await ui.press({ key: 'agent:agent-helper' })
    expect((await ui.find({ key: 'agent:agent-helper' }))?.props.variant).toBe('primary')
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.press({ key: 'agent:main' })
    await ui.unmount()
  }
})

test('Talk: the Orchestrator`s is the whole log, who handed what to whom in order; an agent`s is its own; a press opens a message', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const data = busyData()
  world(on, { restored: snapshot(data) })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('details'))
  await clock.advance(1000)

  const [prompt, toFixer, toHelper, result] = data.messages
  const talk = async (ui: Drawing) => (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('msg:'))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // the Orchestrator opens on Talk
    await ui.press({ key: 'agent:main' })
    expect((await ui.find({ key: 'detail:chat' }))?.props.dimColor).toBe(false)
    const all = await talk(ui)
    expect(all.map(row => row.props.label)).toEqual(['You → Orchestrator', 'Orchestrator → fixer', 'fixer → helper', 'helper → fixer'])
    expect(all.map(row => row.key)).toEqual([prompt, toFixer, toHelper, result].map(message => `msg:${message?.id}`))

    // an agent opens on Diffs; its Talk is its own
    await ui.press({ key: 'agent:agent-fixer' })
    expect(await talk(ui)).toEqual([])
    await ui.press({ key: 'detail:chat' })
    expect((await talk(ui)).map(row => row.props.label)).toEqual(['Orchestrator → fixer', 'fixer → helper', 'helper → fixer'])
    await ui.press({ key: `msg:${result?.id}` })
    expect(await ui.find({ type: 'Markdown', text: /It is src\/auth\.ts/ })).toBeDefined()
    await ui.press({ key: `msg:${result?.id}` })
    expect(await ui.find({ type: 'Markdown', text: /It is src\/auth\.ts/ })).toBeUndefined()

    await ui.press({ key: 'detail:edits' })
    await ui.press({ key: 'agent:main' })
    await ui.unmount()
  }
})

test('Talk sends to the agent from its field', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const sent: Sent[] = []
  world(on, { restored: snapshot(busyData()), sent })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('details'))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'agent:agent-fixer' })
    await ui.press({ key: 'detail:chat' })
    expect(await ui.find({ type: 'Text', text: 'Fix the login bug in src/auth.ts and run the tests' })).toBeDefined()
    await ui.input({ key: 'chat:agent-fixer', text: `  hello from ${surface}  ` })
    await ui.press({ key: 'detail:edits' })
    await ui.press({ key: 'agent:main' })
    await ui.unmount()
  }

  expect(sent).toEqual([
    { to: 'agent-fixer', text: 'hello from terminal' },
    { to: 'agent-fixer', text: 'hello from desktop' },
  ])
})

test('the band above the prompt shows only while a subagent runs, one line and an Open button', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const opened: string[] = []
  world(on, { opened })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })

  for (const surface of SURFACES) {
    const quiet = await $.ui.mount(band(surface))
    expect(await quiet.find({ key: 'band:open' })).toBeUndefined()
    expect(await quiet.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
    await quiet.unmount()
  }

  await $.agent.spawn(spawn('scout', 'look around', 'Look around src/'))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ type: 'Text', text: ' scout' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' look around' })).toBeDefined()
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(button => button.key)).toEqual(['band:open'])
    expect(buttons[0]?.props.hotkey).toBeUndefined()
    await ui.press({ key: 'band:open' })
    await ui.unmount()
  }
  expect(opened).toEqual(['agent-deck', 'agent-deck'])

  // Open shows this session's Dashboard
  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ key: 'tab:dashboard' }))?.props.dimColor).toBe(false)
  await ui.unmount()

  await $.turn.complete({ turnId: 't2', answer: 'Found it.', durationMs: 1500, isAborted: false, reason: 'answer', agentId: 'agent-scout' })
  await clock.advance(1000)
  for (const surface of SURFACES) {
    const done = await $.ui.mount(band(surface))
    expect(await done.find({ key: 'band:open' })).toBeUndefined()
    await done.unmount()
  }
})

test('the band puts the agent that waits on you first, saying for what; the others follow in spawn order', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const data = busyData()
  const helper = M.agentOf(data, 'agent-helper')!
  M.beginTool(data, helper, M.activityOf('t2', 'Bash', { command: 'npm run lint', description: 'Lint the auth module' }, '/repo', NOW - 10_000))
  M.noteNeeds(data, { kind: 'permission_prompt', text: 'Claude needs your permission to use Bash', at: NOW - 5_000, agent: helper.id })
  world(on, { restored: snapshot(data) })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    const labels = (await ui.findAll({ type: 'Text' })).filter(text => text.props.bold === true).map(text => text.text)
    expect(labels).toEqual([' helper', ' fixer'])
    const waits = (await ui.findAll({ type: 'Text', text: ' needs your OK to run `npm run lint`' })).filter(text => text.children.every(child => typeof child === 'string'))
    expect(waits.map(text => text.props.color)).toEqual([T.warn])
    const squares = (await ui.findAll({ type: 'Text', text: '■' })).filter(text => text.children.every(child => typeof child === 'string'))
    expect(squares.map(square => square.props.color)).toEqual([T.warn, T.ok])
    // the line reads in that order
    const line = (await ui.findAll({ type: 'Text' })).find(text => text.text.includes(' needs your OK'))
    expect(line?.text.indexOf(' helper')).toBeLessThan(line?.text.indexOf(' fixer') ?? -1)
    await ui.unmount()
  }
})

test('old saved tab names normalise, from a snapshot and from /deck; /deck alone opens the Dashboard', async ($, on) => {
  expect(M.TABS).toEqual(['dashboard', 'org', 'changes', 'stats', 'agents'])
  expect(M.defaultView().tab).toBe('dashboard')
  expect(['overview', 'diffs', 'commits', 'graph', 'flow', 'classic', 'agents', 'dashboard', 'org', 'changes', 'stats', 'nonsense', 7].map(M.tabNamed)).toEqual([
    'stats',
    'changes',
    'changes',
    'agents',
    'agents',
    'agents',
    'agents',
    'dashboard',
    'org',
    'changes',
    'stats',
    undefined,
    undefined,
  ])
  expect(M.healView({ tab: 'diffs' }).tab).toBe('changes')
  expect(M.healView({ tab: 'overview' }).tab).toBe('stats')
  expect(M.healView({ tab: 'toString' }).tab).toBe('dashboard')
  expect(['a', 'c', 's', 'o', 'co', 'd', 'g', 'f', 'cl', 'x', ''].map(M.tabFor)).toEqual(['agents', 'changes', 'stats', 'org', 'changes', 'dashboard', 'agents', 'agents', 'agents', undefined, undefined])

  // a live session saved on the old Diffs tab comes back on Changes; /deck alone opens its Dashboard
  const clock = mock.clock(on, { now: NOW })
  const saved = snapshot(busyData())
  world(on, { restored: { ...saved, view: { ...saved.view, tab: 'diffs' } as unknown as DeckSnapshot['view'] } })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await clock.advance(1000)
  const isOpen = async (tab: string) => {
    const ui = await $.ui.mount(pane('desktop'))
    const open = (await ui.find({ key: `tab:${tab}` }))?.props.dimColor === false
    await ui.unmount()
    return open
  }
  expect(await isOpen('changes')).toBe(true)
  await $.command.run(deck(''))
  expect(await isOpen('dashboard')).toBe(true)
  await $.command.run(deck('org'))
  expect(await isOpen('org')).toBe(true)

  await $.command.run(deck('overview'))
  expect(await isOpen('stats')).toBe(true)
  await $.command.run(deck('graph'))
  expect(await isOpen('agents')).toBe(true)
  await $.command.run(deck('commits'))
  expect(await isOpen('changes')).toBe(true)
  await $.command.run(deck('a'))
  expect(await isOpen('agents')).toBe(true)
})

test('the Agents tab stays inside the host bounds with eighty agents, two hundred messages and long diffs', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const data = busyData()
  const fixer = M.agentOf(data, 'agent-fixer')!
  for (let i = 0; i < 76; i++) agent(data, `agent-${i}`, `worker-${i}`, { parentId: i % 3 === 0 ? M.MAIN : `agent-${i - 1}`, description: `Task ${i} `.repeat(30) })
  for (let i = 0; i < 200; i++) M.addMessage(data, { from: i % 2 ? fixer.id : M.MAIN, to: i % 2 ? M.MAIN : fixer.id, kind: i % 2 ? 'result' : 'spawn', text: `Message ${i} `.repeat(80), at: NOW - 100_000 + i })
  const long = ['@@ -1,60 +1,60 @@', ...Array.from({ length: 60 }, (_, i) => `-old line ${i} ${'x'.repeat(30)}`)].join('\n').slice(0, M.LIMITS.patchChars)
  for (let i = 0; i < 160; i++) M.addEdit(data, fixer, { id: `e${i}`, agent: fixer.id, tool: 'Edit', path: `src/deep/folder/file${i % 30}.ts`, abs: `/repo/src/deep/folder/file${i % 30}.ts`, at: NOW - 90_000 + i, added: 0, removed: 60, patch: long, isNew: false })
  world(on, { restored: snapshot(data, { agent: fixer.id }) })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('details'))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    for (const shown of ['edits', 'chat', 'activity', 'edits']) {
      await ui.press({ key: `detail:${shown}` })
      const size = treeSize(await ui.drawn())
      expect(size.nodes < 20_000 && size.depth < 32 && size.chars < 100_000).toBe(true)
    }
    expect((await ui.findAll({ type: 'Code' })).length > 0).toBe(true)
    // every agent a row of the outline, the selected one among them; no image anywhere
    expect((await rowsOf(ui)).length).toBe(1 + 78)
    expect((await ui.find({ key: 'agent:agent-fixer' }))?.props.variant).toBe('primary')
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
})

test('outside a repository the summary counts the agents` own edits, and the Orchestrator`s edit shows as a diff', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, { isRepo: false })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/notes' })
  await $.command.run(deck('details'))
  await $.turn.start({ text: 'fix app.ts', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'const b = 2', new_string: 'const b = 3' })
  await $.turn.complete({ turnId: 't1', answer: 'Fixed.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ type: 'Text', text: /^1 file$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^(Nothing needs you|All done · 1 file to review)$/ })).toBeDefined()
    expect((await copperBars(ui)).filter(bar => /Nothing needs you|All done/.test(bar.text))).toEqual([])
    // its own edit, under its detail's Diffs
    await ui.press({ key: 'agent:main' })
    await ui.press({ key: 'detail:edits' })
    expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
    await ui.unmount()
  }
})
