import type { On, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { emptyGit, type FileRow } from '../hooks/git'
import * as M from '../hooks/model'
import { treeSize } from '../hooks/ui/common'
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

type Found = { type: string; key: string | undefined; props: Record<string, unknown>; text: string }

/** Every Box drawn with the quote border: the banner's bar, and on the terminal the map's rails. */
async function quoteBoxes(ui: { findAll: (query: { type?: string }) => Promise<Found[]> }): Promise<Found[]> {
  return (await ui.findAll({ type: 'Box' })).filter(box => box.props.borderStyle === 'quote')
}

test('the default tab is Agents: the tab row, then the status bar and the banner, on each surface', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'tab:agents' }))?.props).toMatchObject({ dimColor: false, hotkey: '1' })
    expect((await ui.find({ key: 'tab:changes' }))?.props).toMatchObject({ dimColor: true, hotkey: '2' })
    expect((await ui.find({ key: 'tab:stats' }))?.props).toMatchObject({ dimColor: true, hotkey: '3' })
    expect(await ui.find({ type: 'Text', text: 'Agent deck' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · repo · main' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2 files' })).toBeDefined()
    // nobody at work: the banner is the uncommitted work, plain, with no bar
    expect(await ui.find({ type: 'Text', text: M.bannerOf(M.emptyData(NOW), GIT, NOW).text })).toBeDefined()
    expect((await ui.findAll({ type: 'Box' })).some(box => box.props.borderStyle === 'quote' && box.props.borderColor !== undefined)).toBe(false)
    // the Orchestrator is selected and opens on its Diffs
    expect((await ui.find({ key: 'agent:main' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'detail:edits' }))?.props.dimColor).toBe(false)
    expect(await ui.find({ type: 'Text', text: 'No edits by Orchestrator yet. Its Edit and Write calls show here as exact diffs.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'No messages yet. Prompts, hand-offs and replies show here in order.' })).toBeDefined()
    await ui.unmount()
  }
})

const BANNERS: { name: string; data: () => DeckData; isLoud: boolean }[] = [
  { name: 'who runs, and what the busiest is doing', data: busyData, isLoud: false },
  {
    name: 'a failure leads, on the bar',
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
]

for (const banner of BANNERS) {
  test(`the banner says the one thing to notice: ${banner.name}`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const data = banner.data()
    world(on, { restored: snapshot(data) })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
    await $.command.run(deck(''))
    await clock.advance(1000)

    const said = M.bannerOf(data, GIT, NOW)
    expect(said.tone === 'alert' || said.tone === 'attention').toBe(banner.isLoud)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      const bars = (await quoteBoxes(ui)).filter(box => box.props.borderColor !== undefined)
      if (banner.isLoud) {
        // the subject bold, the rest plain, behind the accent bar
        const cut = said.text.indexOf(': ')
        const subject = cut > 0 ? said.text.slice(0, cut) : said.text
        expect(bars.length).toBe(1)
        expect(bars[0]?.text).toContain(subject)
        expect(await ui.find({ type: 'Text', text: ` ${subject}` })).toBeDefined()
      } else {
        expect(bars).toEqual([])
        expect(await ui.find({ type: 'Text', text: said.text })).toBeDefined()
      }
      await ui.unmount()
    }
  })
}

test('the map: an Svg tree on the desktop that Wire switches, railed rows on the terminal', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, { restored: snapshot(busyData()) })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('agents'))
  await clock.advance(1000)

  const desktop = await $.ui.mount(pane('desktop'))
  const tree = String((await desktop.find({ type: 'Svg' }))?.props.source)
  expect(tree).toContain('class="plate"')
  expect(tree).toContain('fixer')
  expect(tree).toContain('helper')
  // the latest prompt labels the You → Orchestrator edge
  expect(tree).toContain('Fix the login bug')
  expect((await desktop.find({ key: 'map:tree' }))?.props.dimColor).toBe(false)

  await desktop.press({ key: 'map:wire' })
  const wire = String((await desktop.find({ type: 'Svg' }))?.props.source)
  expect(wire).toContain('class="lane"')
  expect(wire).not.toContain('class="plate"')
  expect(wire).toContain('It is src/auth.ts')
  expect((await desktop.find({ key: 'map:wire' }))?.props.dimColor).toBe(false)

  await desktop.press({ key: 'map:tree' })
  expect(String((await desktop.find({ type: 'Svg' }))?.props.source)).toBe(tree)
  await desktop.unmount()

  const terminal = await $.ui.mount(pane('terminal'))
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  expect(await terminal.find({ key: 'map:wire' })).toBeUndefined()
  // helper sits one rail deeper than fixer, which sits one deeper than the Orchestrator
  const rails = await quoteBoxes(terminal)
  expect(rails.length).toBe(3)
  expect(rails[0]?.text).toContain('fixer')
  expect(rails[2]?.text).toContain('helper')
  expect(rails[2]?.text).not.toContain('fixer')
  expect(await terminal.find({ type: 'Text', text: '  Run the unit tests' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: '  Fix the login bug' })).toBeDefined()
  await terminal.unmount()
})

test('pressing an agent in the strip opens its summary, and Diffs shows its exact patch', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, { restored: snapshot(busyData()) })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // the strip: a native Button per agent, never plain, the selected one the primary plate
    for (const key of ['agent:main', 'agent:agent-fixer', 'agent:agent-helper']) expect((await ui.find({ key }))?.props.plain).toBeUndefined()
    await ui.press({ key: 'agent:agent-fixer' })
    expect((await ui.find({ key: 'agent:agent-fixer' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'agent:main' }))?.props.variant).toBeUndefined()

    for (const label of ['Task', 'Now', 'Result', 'Talked to']) expect(await ui.find({ type: 'Text', text: label })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Fix the login bug in src/auth.ts and run the tests' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Run the unit tests' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' ×2' })).toBeDefined()

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
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'No edits by helper yet. Its Edit and Write calls show here as exact diffs.' })).toBeDefined()
    await ui.press({ key: 'agent:main' })
    await ui.unmount()
  }
})

test('a press on a message row selects the agent it went to and marks the row', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const data = busyData()
  world(on, { restored: snapshot(data) })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await clock.advance(1000)

  const [prompt, toFixer, toHelper, result] = data.messages
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const rows = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('msg:'))
    expect(rows.map(row => row.props.label)).toEqual(['You → Orchestrator', 'Orchestrator → fixer', 'fixer → helper', 'helper → fixer'])
    // no row is marked until one is pressed (the pick then stays across surfaces)
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: '▌' })).toBeUndefined()

    const picks: [string | undefined, string][] = [
      [toHelper?.id, 'agent:agent-helper'],
      [result?.id, 'agent:agent-fixer'],
      [prompt?.id, 'agent:main'],
      [toFixer?.id, 'agent:agent-fixer'],
    ]
    for (const [id, opened] of picks) {
      await ui.press({ key: `msg:${id}` })
      expect((await ui.find({ key: opened }))?.props.variant).toBe('primary')
      expect((await ui.findAll({ type: 'Text', text: '▌' })).length).toBe(1)
    }
    await ui.unmount()
  }
})

test('Conversation draws the transcript as bubbles, and its field sends to the agent', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const sent: Sent[] = []
  world(on, {
    restored: snapshot(busyData()),
    sent,
    messages: [
      { role: 'user', text: 'Fix the login bug in src/auth.ts', toolUses: [] },
      { role: 'assistant', text: 'Looking at **src/auth.ts** now.', toolUses: [{ tool_use_id: 'toolu_r', tool: 'Read', input: { file_path: '/repo/src/auth.ts' } }] },
    ],
  })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'agent:agent-fixer' })
    await ui.press({ key: 'detail:chat' })
    expect(await ui.find({ type: 'Markdown', text: /Looking at/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Read src/auth.ts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'fixer' })).toBeDefined()
    await ui.input({ key: 'chat:agent-fixer', text: `  hello from ${surface}  ` })
    await ui.press({ key: 'detail:edits' })
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

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ key: 'tab:agents' }))?.props.dimColor).toBe(false)
  await ui.unmount()

  await $.turn.complete({ turnId: 't2', answer: 'Found it.', durationMs: 1500, isAborted: false, reason: 'answer', agentId: 'agent-scout' })
  await clock.advance(1000)
  for (const surface of SURFACES) {
    const done = await $.ui.mount(band(surface))
    expect(await done.find({ key: 'band:open' })).toBeUndefined()
    await done.unmount()
  }
})

test('old saved tab names normalise, from a snapshot and from /deck', async ($, on) => {
  expect(M.TABS).toEqual(['agents', 'changes', 'stats'])
  expect(M.defaultView().tab).toBe('agents')
  expect(['overview', 'diffs', 'commits', 'graph', 'flow', 'agents', 'changes', 'stats', 'nonsense', 7].map(M.tabNamed)).toEqual([
    'stats',
    'changes',
    'changes',
    'agents',
    'agents',
    'agents',
    'changes',
    'stats',
    undefined,
    undefined,
  ])
  expect(M.healView({ tab: 'diffs' }).tab).toBe('changes')
  expect(M.healView({ tab: 'overview' }).tab).toBe('stats')
  expect(M.healView({ tab: 'toString' }).tab).toBe('agents')
  expect(['a', 'c', 's', 'o', 'co', 'd', 'g', 'f', 'x', ''].map(M.tabFor)).toEqual(['agents', 'changes', 'stats', 'stats', 'changes', 'changes', 'agents', 'agents', undefined, undefined])

  // a live session saved on the old Diffs tab comes back on Changes
  const clock = mock.clock(on, { now: NOW })
  const saved = snapshot(busyData())
  world(on, { restored: { ...saved, view: { ...saved.view, tab: 'diffs' } as unknown as DeckSnapshot['view'] } })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await clock.advance(1000)
  const isOpen = async (tab: string) => {
    const ui = await $.ui.mount(pane('desktop'))
    const open = (await ui.find({ key: `tab:${tab}` }))?.props.dimColor === false
    await ui.unmount()
    return open
  }
  expect(await isOpen('changes')).toBe(true)

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
  await $.command.run(deck(''))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    for (const shown of ['edits', 'chat', 'activity', 'edits']) {
      await ui.press({ key: `detail:${shown}` })
      const size = treeSize(await ui.drawn())
      expect(size.nodes < 20_000 && size.depth < 32 && size.chars < 100_000).toBe(true)
    }
    expect((await ui.findAll({ type: 'Code' })).length > 0).toBe(true)
    expect((await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('msg:')).length).toBe(14)
    expect(await ui.find({ type: 'Text', text: '186 earlier' })).toBeDefined()
    if (surface === 'desktop') expect(String((await ui.find({ type: 'Svg' }))?.props.source).length < 131_072).toBe(true)
    await ui.unmount()
  }
})

test('outside a repository the status bar says so, and the Orchestrator`s edit shows as a diff', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, { isRepo: false })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/notes' })
  await $.command.run(deck(''))
  await $.turn.start({ text: 'fix app.ts', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'const b = 2', new_string: 'const b = 3' })
  await $.turn.complete({ turnId: 't1', answer: 'Fixed.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ type: 'Text', text: ' · no repository' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 file' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'All quiet' })).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
    await ui.unmount()
  }
})
