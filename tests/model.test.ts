import type { Args, On } from 'claude-code'
import { expect, mock, test, type MockClock } from 'claude-code/testing'

import { emptyGit, type FileRow } from '../hooks/git'
import * as M from '../hooks/model'
import type { DeckAgent, DeckData, DeckSnapshot, DeckStatus } from '../types'
import { bash } from './tools'

const HASH = 'c'.repeat(40)
/** On a minute's edge, so a test's first minute is whole. */
const NOW = 1_700_000_100_000

const PANE = {
  title: 'Agent Deck',
  isFocused: true,
  bodyColumns: 96,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

const VIEWPORT = { columns: 100, rows: 50, isFullscreen: true }

/** /deck as typed at the prompt, with what the engine stamps on it. */
function deck(args: string) {
  return { command: 'deck', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 100 } }
}

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

/** What git prints in a repository at /repo with one changed file. */
function gitOut(argv: readonly string[]): { exitCode: number; stdout: string } {
  const line = argv.join(' ')
  if (line.includes('rev-parse --show-toplevel')) return { exitCode: 0, stdout: '/repo\n' }
  if (line.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: 'main\n' }
  if (line.includes('rev-parse --verify --quiet HEAD')) return { exitCode: 0, stdout: `${HASH}\n` }
  if (line.includes('@{upstream}')) return { exitCode: 128, stdout: '' }
  if (line.includes('status --porcelain')) return { exitCode: 0, stdout: ' M src/app.ts\0' }
  if (line.includes('--numstat -z HEAD')) return { exitCode: 0, stdout: '1\t1\tsrc/app.ts\0' }
  if (line.includes('rev-list --count')) return { exitCode: 0, stdout: '1\n' }
  if (line.includes(' log --since')) return { exitCode: 0, stdout: '\x1e\n 1 file changed, 2 insertions(+)\n' }
  if (line.includes(' log -n30')) return { exitCode: 0, stdout: `\x1e${HASH}\x1f${HASH.slice(0, 7)}\x1fSam\x1f1700000000\x1fFirst commit\n\n 1 file changed, 2 insertions(+)\n` }
  return { exitCode: 1, stdout: '' }
}

/**
 * Answers every engine call the deck makes, in Claude Code's place. A Bash
 * call answers `bashMs` late on the mocked clock, so a test can act while it
 * is in flight; `saved` collects each snapshot the deck keeps in `$.state`,
 * and `restored` is the snapshot a reload finds there.
 */
function world(on: On, clock: MockClock, options: { bashMs?: number; saved?: DeckSnapshot[]; restored?: unknown } = {}) {
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } } }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', ($, e) => ({ value: { ...gitOut(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: NOW, isLink: false } }))
  on('fs.read', () => ({ value: 'hello\nworld\n' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku', agentId: 'agent-x1' }))
  on('classic.Notification', () => ({}))
  on('tool.call', async ($, e) => {
    // compared as a string: the tool table may lack Bash (tests/tools.ts)
    if ((e.tool as string) === 'Bash' && options.bashMs) await clock.sleep(options.bashMs)
    if (e.tool === 'TaskCreate') return { result: { task: { id: '7', subject: e.subject } } }
    return { result: 'ok' }
  })

  const saved = options.saved
  if (saved) {
    let version = options.restored === undefined ? 0 : 1
    on('state.get', { plugin: 'agent-deck', key: 'snapshot' }, () => ({ value: { value: options.restored as DeckSnapshot | undefined, version } }))
    on('state.set', { plugin: 'agent-deck', key: 'snapshot' }, ($, e) => {
      saved.push(JSON.parse(JSON.stringify(e.value)) as DeckSnapshot)
      version += 1
      return { value: { isSet: true as const, version } }
    })
  }
}

/** The last snapshot the deck kept. */
function lastOf(saved: readonly DeckSnapshot[]): DeckSnapshot {
  const last = saved[saved.length - 1]
  if (!last) throw new Error('the deck kept no snapshot')
  return last
}

function mainOf(saved: readonly DeckSnapshot[]): DeckAgent {
  const main = M.agentOf(lastOf(saved).data, M.MAIN)
  if (!main) throw new Error('no Orchestrator in the snapshot')
  return main
}

function addAgent(data: DeckData, id: string, name: string, extra: Partial<DeckAgent> = {}): DeckAgent {
  const agent = M.newAgent(id, 'agent', name, NOW - 300_000, { type: 'general-purpose', parentId: M.MAIN, status: 'running', ...extra })
  data.agents.push(agent)
  return agent
}

function fileRow(path: string): FileRow {
  return { path, code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 2, removed: 1 }
}

test('bannerOf: a recent failure leads, then waiting on you, then who runs and what the busiest does, then uncommitted work, then all quiet', async () => {
  const data = M.emptyData(NOW - 600_000)
  const git = { ...emptyGit(), isRepo: true, files: Array.from({ length: 7 }, (_, i) => fileRow(`src/f${i}.ts`)) }

  const fixer = addAgent(data, 'a-fixer', 'fixer')
  M.beginTool(data, fixer, M.activityOf('t1', 'Bash', { command: 'npm test', description: 'Run the unit tests' }, null, NOW - 5_000))
  addAgent(data, 'a-scout', 'scout', { status: 'failed', endedAt: NOW - 120_000, answer: '## Could not finish\nThe tests would not run.' })
  const tester = addAgent(data, 'a-tester', 'tester', { status: 'failed', endedAt: NOW - 30_000 })
  M.beginTool(data, tester, M.activityOf('t9', 'Bash', { command: 'npm run e2e' }, null, NOW - 40_000))
  M.endTool(tester, 't9', false, NOW - 31_000)

  // 1. failures in the last ten minutes: counted, the latest named with why
  expect(M.bannerOf(data, git, NOW)).toEqual({ tone: 'alert', text: '2 failed · tester: Bash npm run e2e failed', agentId: 'a-tester' })
  // an agent stopped (killed) is no failure to shout about
  tester.status = 'killed'
  expect(M.bannerOf(data, git, NOW)).toEqual({ tone: 'alert', text: 'scout failed: Could not finish', agentId: 'a-scout' })

  // 2. ten minutes on the failure no longer leads: the engine waiting on you does
  const later = NOW + M.FAILED_SHOWN_MS
  M.noteNeeds(data, { kind: 'permission_prompt', text: 'Claude needs your permission to use Bash', at: later })
  expect(M.bannerOf(data, git, later)).toEqual({ tone: 'attention', text: 'Claude needs your permission to use Bash', agentId: 'a-fixer' })
  expect(M.statusOf(M.agentOf(data, M.MAIN)!)).toBe('waiting')
  // another call of another agent is no answer; the held call's end is
  expect(M.clearNeeds(data, { kind: 'start', agent: 'a-scout' })).toBe(false)
  M.endTool(fixer, 't1', true, later)
  expect(M.clearNeeds(data, { kind: 'end', agent: 'a-fixer', call: 't1' })).toBe(true)
  expect(M.agentOf(data, M.MAIN)?.needs).toBeUndefined()

  // an agent held on its own is waiting; held on a child agent of its own at work, it is busy
  const lead = addAgent(data, 'a-lead', 'lead', { status: 'waiting', description: 'Plan the fix', lastAt: later })
  expect(M.bannerOf(data, git, later)).toEqual({ tone: 'attention', text: 'lead is waiting: Plan the fix', agentId: 'a-lead' })
  const child = addAgent(data, 'a-child', 'child', { parentId: 'a-lead' })

  // 3. who runs, and what the busiest is doing
  expect(M.bannerOf(data, git, later)).toEqual({ tone: 'busy', text: '2 running · fixer: Run the unit tests', agentId: 'a-fixer' })
  M.beginTool(data, child, M.activityOf('t2', 'Read', { file_path: '/repo/src/auth.ts' }, '/repo', later))
  expect(M.bannerOf(data, git, later)).toEqual({ tone: 'busy', text: '2 running · child: Read src/auth.ts', agentId: 'a-child' })

  // 4. nobody at work: what is left uncommitted
  for (const agent of [fixer, child, lead]) agent.status = 'completed'
  expect(M.bannerOf(data, git, later)).toEqual({ tone: 'quiet', text: '7 files changed, not committed' })
  expect(M.bannerOf(data, { ...git, files: [fileRow('a.ts')] }, later).text).toBe('1 file changed, not committed')

  // 5. all quiet
  expect(M.bannerOf(data, { ...git, files: [] }, later)).toEqual({ tone: 'quiet', text: 'All quiet' })
  expect(M.bannerOf(data, { ...git, isRepo: false }, later)).toEqual({ tone: 'quiet', text: 'All quiet' })
})

test('nowOf: the call in flight (a shell description before its command), else the todo in progress, else the last call, else the task', async () => {
  const data = M.emptyData(NOW)
  const agent = addAgent(data, 'a1', 'fixer', { description: 'Fix the login bug' })
  expect(M.nowOf(agent)).toBe('Fix the login bug')

  M.beginTool(data, agent, M.activityOf('t1', 'Bash', { command: 'npm test -- --run', description: 'Run the unit tests' }, null, NOW))
  expect(M.nowOf(agent)).toBe('Run the unit tests')
  M.endTool(agent, 't1', true, NOW + 1000)
  expect(M.nowOf(agent)).toBe('Run the unit tests')
  M.beginTool(data, agent, M.activityOf('t2', 'PowerShell', { command: 'Get-ChildItem' }, null, NOW + 2000))
  expect(M.nowOf(agent)).toBe('PowerShell Get-ChildItem')
  M.endTool(agent, 't2', true, NOW + 3000)

  // the in-progress item of a TodoWrite shows between calls; the TodoWrite call itself is no news
  const todos = {
    todos: [
      { content: 'Write the test', status: 'completed', activeForm: 'Writing the test' },
      { content: 'Fix the bug', status: 'in_progress', activeForm: 'Fixing the bug' },
    ],
  }
  M.beginTool(data, agent, M.activityOf('t3', 'TodoWrite', todos, null, NOW + 4000))
  M.noteTodo(data, agent, 'TodoWrite', todos, { oldTodos: [], newTodos: todos.todos })
  expect(M.nowOf(agent)).toBe('Fixing the bug')
  M.endTool(agent, 't3', true, NOW + 4100)
  M.beginTool(data, agent, M.activityOf('t4', 'Read', { file_path: '/repo/src/app.ts' }, '/repo', NOW + 5000))
  expect(M.nowOf(agent)).toBe('Read src/app.ts')
  M.endTool(agent, 't4', true, NOW + 6000)
  expect(M.nowOf(agent)).toBe('Fixing the bug')

  // every item done: the last call again
  M.noteTodo(data, agent, 'TodoWrite', { todos: [{ content: 'Fix the bug', status: 'completed', activeForm: 'Fixing the bug' }] }, null)
  expect(M.nowOf(agent)).toBe('Read src/app.ts')

  // the task list: TaskCreate books the words, TaskUpdate starts the task and ends it
  M.noteTodo(data, agent, 'TaskCreate', { subject: 'Run the suite', description: 'all of it', activeForm: 'Running the suite' }, { task: { id: '7', subject: 'Run the suite' } })
  expect(M.nowOf(agent)).toBe('Read src/app.ts')
  M.noteTodo(data, agent, 'TaskUpdate', { taskId: '7', status: 'in_progress' }, { success: true, taskId: '7', updatedFields: ['status'] })
  expect(M.nowOf(agent)).toBe('Running the suite')
  M.noteTodo(data, agent, 'TaskUpdate', { taskId: '8', status: 'completed' }, { success: true, taskId: '8', updatedFields: ['status'] })
  expect(M.nowOf(agent)).toBe('Running the suite')
  M.noteTodo(data, agent, 'TaskUpdate', { taskId: '7', status: 'completed' }, { success: true, taskId: '7', updatedFields: ['status'] })
  expect(M.nowOf(agent)).toBe('Read src/app.ts')
})

test('a TodoWrite through the hooks: the Orchestrator says what it is doing until its turn ends', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, clock, { saved })

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Fix the bug', status: 'in_progress', activeForm: 'Fixing the bug' }] })
  await clock.advance(2000)
  expect(mainOf(saved).todo).toEqual({ text: 'Fixing the bug' })
  expect(M.nowOf(mainOf(saved))).toBe('Fixing the bug')

  await $.tool.call({ tool: 'TaskCreate', subject: 'Run the suite', description: 'all of it', activeForm: 'Running the suite' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' })
  await clock.advance(2000)
  expect(lastOf(saved).data.tasks).toEqual({ '7': 'Running the suite' })
  expect(M.nowOf(mainOf(saved))).toBe('Running the suite')

  await $.turn.complete({ turnId: 't1', answer: 'Fixed.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await clock.advance(2000)
  expect(mainOf(saved).todo).toBeUndefined()
})

test('statusOf folds the engine statuses into the five the deck draws; elapsedOf stays coarse while an agent runs', async () => {
  const shown = (status: DeckStatus, extra: Partial<DeckAgent> = {}) => M.statusOf(M.newAgent('a', 'agent', 'x', NOW, { status, ...extra }))
  expect(shown('running')).toBe('running')
  expect(shown('pending')).toBe('running')
  expect(shown('waiting')).toBe('waiting')
  expect(shown('idle')).toBe('idle')
  expect(shown('completed')).toBe('done')
  expect(shown('failed')).toBe('failed')
  expect(shown('killed')).toBe('failed')
  expect(shown('running', { needs: { text: 'Claude needs your permission to use Bash', kind: 'permission_prompt', at: NOW } })).toBe('waiting')
  expect(M.statusOf(M.newAgent(M.YOU, 'you', 'You', NOW, { status: 'running' }))).toBe('idle')
  expect(M.statusOf(M.newAgent('peer:x', 'peer', 'x', NOW, { status: 'running' }))).toBe('idle')

  const agent = M.newAgent('a', 'agent', 'x', NOW, { status: 'running' })
  expect(M.elapsedOf(agent, NOW + 59_000)).toBe('<1m')
  expect(M.elapsedOf(agent, NOW + 61_000)).toBe('1m')
  expect(M.elapsedOf(agent, NOW + 3_725_000)).toBe('1h 02m')
  agent.endedAt = NOW + 42_000
  expect(M.elapsedOf(agent, NOW + 3_725_000)).toBe('42s')
})

test('a restored view is healed field by field, and a reload keeps the tracked agents', async ($, on) => {
  const data = M.emptyData(NOW)
  data.agents.push(M.newAgent('agent-old', 'agent', 'scout', NOW, { status: 'running', parentId: M.MAIN }))
  const spawned = M.addMessage(data, { from: M.MAIN, to: 'agent-old', kind: 'spawn', text: 'look around', at: NOW })

  // a fresh view selects nothing: no detail until a row is picked
  expect(M.defaultView().agent).toBe('')
  expect(M.healView(undefined)).toEqual(M.defaultView())
  expect(M.healView('agents')).toEqual(M.defaultView())
  expect(
    M.healView({ tab: 'flow', agent: 'agent-old', agentPane: 'chat', file: 7, showFiles: 'no', isBandHidden: true, map: 'sideways', message: 'gone' }, data),
  ).toEqual({ ...M.defaultView(), tab: 'agents', agent: 'agent-old', agentPane: 'chat', isBandHidden: true })
  // an agent page names an agent the deck holds (the sample's are the sample's), and the sample is a flag
  expect(M.healView({ page: 'agent-old', isDemo: 'yes' }, data)).toMatchObject({ page: 'agent-old', isDemo: false })
  expect(M.healView({ page: 'agent-gone' }, data).page).toBe('')
  expect(M.healView({ page: 'demo-agent', isDemo: true }, data)).toMatchObject({ page: 'demo-agent', isDemo: true })
  // an agent it no longer holds is let go: nothing selected; a saved selection it holds stays, the Orchestrator's too
  expect(M.healView({ tab: 'stats', map: 'wire', agent: 'agent-gone', message: spawned.id }, data)).toEqual({
    ...M.defaultView(),
    tab: 'stats',
    map: 'wire',
    agent: '',
    message: spawned.id,
  })
  expect(M.healView({ agent: M.MAIN }, data).agent).toBe(M.MAIN)

  // what an older build kept: no map, no message, no task book
  const { tasks: _tasks, ...olderData } = data
  const older = {
    v: M.SNAPSHOT_VERSION,
    data: olderData,
    view: { tab: 'graph', agent: 'agent-old', agentPane: 'activity', file: '', commit: '', filter: 'all', showFiles: false, isBandHidden: false },
  }
  const clock = mock.clock(on, { now: NOW + 5_000 })
  const saved: DeckSnapshot[] = []
  world(on, clock, { saved, restored: older })

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await clock.advance(2000)
  const kept = lastOf(saved)
  expect(kept.v).toBe(M.SNAPSHOT_VERSION)
  // its graph tab is the Agents tab now (Classic); /deck opens v2's Now, the earlier build's fields left as they were
  expect(M.healView(older.view, kept.data).tab).toBe('agents')
  expect(kept.view).toEqual({ ...M.defaultView(), tab: 'agents', agent: 'agent-old', agentPane: 'activity', showFiles: false })
  expect(kept.data.agents.map(agent => agent.id)).toEqual([M.YOU, M.MAIN, 'agent-old'])
  expect(kept.data.messages.map(message => message.id)).toEqual([spawned.id])
  expect(kept.data.tasks).toEqual({})
})

test('no redraw while nothing changes: idle ticks raise no ui.invalidate, a tool call does, and a running agent redraws once its minute turns', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, clock)
  let invalidates = 0
  on('ui.invalidate', () => {
    invalidates += 1
    return { value: undefined }
  })

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('agents'))
  await $.agent.spawn(spawn('scout', 'look around', 'Look around src/'))
  await $.tool.call(bash({ command: 'npm test', description: 'Run the unit tests' }))
  const ui = await $.ui.mount({ plugin: 'agent-deck', surface: 'desktop', component: 'Pane', requestId: 'agent-deck', viewport: VIEWPORT, props: PANE })
  expect(await ui.drawn()).toBeDefined()
  await clock.advance(10_000)

  // the pane open, an agent at work: git, usage and agents are re-read, nothing is redrawn
  invalidates = 0
  await clock.advance(30_000)
  expect(invalidates).toBe(0)

  await $.tool.call({ tool: 'Read', file_path: '/repo/src/app.ts' })
  expect(invalidates > 0).toBe(true)
  await ui.unmount()

  // the pane shut, the band's agent still running: quiet until its elapsed time turns a minute
  await $.command.run(deck('close'))
  await clock.advance(5_000)
  invalidates = 0
  await clock.advance(12_000)
  expect(invalidates).toBe(0)
  await clock.advance(5_000)
  expect(invalidates).toBe(1)
})

test('waiting on you: a permission prompt marks the Orchestrator until the call it holds ends; Claude Code saying it is idle for input is no wait', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, clock, { saved, bashMs: 6_000 })

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.turn.start({ text: 'clean up', turnId: 't1' })
  const call = $.tool.call(bash({ command: 'rm -rf build', description: 'Clean the build' }))
  await clock.settle()
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  await clock.advance(2000)

  const asking = mainOf(saved)
  expect(asking.needs).toMatchObject({ kind: 'permission_prompt', text: 'Claude needs your permission to use Bash', agent: M.MAIN })
  expect(asking.needs?.call).toBe(asking.current?.id)
  expect(M.nowOf(asking)).toBe('Clean the build')
  expect(M.statusOf(asking)).toBe('waiting')
  expect(M.bannerOf(lastOf(saved).data, emptyGit(), NOW)).toEqual({ tone: 'attention', text: 'Claude needs your permission to use Bash', agentId: M.MAIN })

  // answered: the held call goes on and ends
  await clock.advance(5000)
  await call
  await clock.advance(2000)
  expect(mainOf(saved).needs).toBeUndefined()

  // idle for input: Claude Code says its turn ended, which asks nothing; nor does a sign-in notice
  await $.turn.complete({ turnId: 't1', answer: 'Cleaned.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })
  await clock.advance(2000)
  expect(mainOf(saved).needs).toBeUndefined()
  expect(M.statusOf(mainOf(saved), lastOf(saved).data)).toBe('idle')
  expect(M.bannerOf(lastOf(saved).data, emptyGit(), NOW).tone).not.toBe('attention')
  expect(M.isNeedsYou('idle_prompt', 'Claude is waiting for your input')).toBe(false)

  await $.classic.Notification({ message: 'Signed in', notification_type: 'auth_success' })
  await clock.advance(2000)
  expect(mainOf(saved).needs).toBeUndefined()
  expect(M.isNeedsYou('something_new', 'Claude needs your approval')).toBe(true)
  expect(M.isNeedsYou('something_new', 'Update installed')).toBe(false)
})

test('messages: a pick opens the agent a message went to (its sender for one sent to you), and talk is counted per counterpart', async () => {
  const data = M.emptyData(NOW)
  data.agents.push(M.newAgent('a1', 'agent', 'fixer', NOW, { status: 'running' }), M.newAgent('a2', 'agent', 'helper', NOW, { status: 'running', parentId: 'a1' }))
  const prompt = M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: 'fix it', at: NOW })
  M.addMessage(data, { from: M.MAIN, to: 'a1', kind: 'spawn', text: 'fix the bug', at: NOW + 1 })
  const ask = M.addMessage(data, { from: 'a1', to: 'a2', kind: 'message', text: 'where is auth?', at: NOW + 2 })
  M.addMessage(data, { from: 'a2', to: 'a1', kind: 'message', text: 'src/auth.ts', at: NOW + 3 })
  const toYou = M.addMessage(data, { from: 'a1', to: M.YOU, kind: 'chat', text: 'done', at: NOW + 4 })
  M.addMessage(data, { from: 'a1', to: M.MAIN, kind: 'result', text: 'fixed', at: NOW + 5 })
  const toGone = M.addMessage(data, { from: 'a1', to: 'agent-gone', kind: 'message', text: 'hello?', at: NOW + 6 })

  expect(M.messageTargetOf(data, prompt.id)).toBe(M.MAIN)
  expect(M.messageTargetOf(data, ask.id)).toBe('a2')
  expect(M.messageTargetOf(data, toYou.id)).toBe('a1')
  expect(M.messageTargetOf(data, toGone.id)).toBeUndefined()
  expect(M.messageTargetOf(data, 'no-such-message')).toBeUndefined()

  expect(M.talkOf(data, 'a1')).toEqual([
    { id: M.MAIN, sent: 1, received: 1, last: NOW + 5 },
    { id: 'a2', sent: 1, received: 1, last: NOW + 3 },
    { id: 'agent-gone', sent: 1, received: 0, last: NOW + 6 },
    { id: M.YOU, sent: 1, received: 0, last: NOW + 4 },
  ])
  expect(M.talkOf(data, 'nobody')).toEqual([])

  // the map's view and the picked message are part of the view a reload keeps
  expect(M.defaultView()).toMatchObject({ map: 'tree', message: '' })
  expect(M.MAP_VIEWS).toEqual(['tree', 'wire'])
})

// The QA live run's four bugs, each replayed as QA met it. Each fails on the build before its fix.

const ASK = 'Is your diff for the token refresh fix ready to review?'
const REPORT = 'Fixed needsRefresh() and added two tests; 4 of 4 pass.'

/** The spawn an Agent call naming the agent `name` raises, in the main loop. */
function named(name: string) {
  return {
    tool_use_id: `toolu_${name}`,
    prompt: `Do the ${name} work.`,
    description: name,
    subagentType: 'general-purpose',
    name,
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-test',
    background: true,
    fork: false,
  }
}

/** A SubagentHandback call in `agentId`'s loop: a tool this build's table does not list. */
function handback(agentId: string, message: string): Args<'tool.call'> {
  return { tool: 'SubagentHandback', message, agentId } as unknown as Args<'tool.call'>
}

/** A tool call made inside agent `agentId`'s loop, as the engine raises it there. */
function inLoop<T extends object>(agentId: string, call: T): T & { agentId: string } {
  return { ...call, agentId }
}

/**
 * The QA run's engine, in Claude Code's place: a named spawn is
 * `agent-<name>`; git sees one repository at `root`, from its own spelling
 * or the 8.3 short one (`short`) as real git does, and prints `root`; and
 * `fs.stat` with `resolve` answers the long spelling, as Windows does.
 * `saved` collects each snapshot the deck keeps.
 */
function qaWorld(on: On, saved: DeckSnapshot[], options: { root?: string; short?: string } = {}) {
  const root = options.root ?? '/repo'
  const short = options.short
  const longOf = (path: string): string => {
    const clean = path.replace(/\\/g, '/')
    return short && clean.toLowerCase().startsWith(short.toLowerCase()) ? `${root}${clean.slice(short.length)}` : clean
  }
  const changed: string[] = []
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
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } } }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', ($, e) => ({ model: 'claude-haiku', agentId: `agent-${e.name ?? 'x'}` }))
  on('session.send', () => ({ isDelivered: true }))
  on('session.receive', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.SubagentStop', () => ({}))
  on('fs.read', () => ({ value: '' }))
  on('fs.stat', ($, e) => {
    const real = longOf(e.path)
    return { value: { kind: 'dir' as const, size: 0, mtimeMs: NOW, isLink: false, ...(e.resolve ? { realPath: /^[a-z]:/i.test(real) ? real.replace(/\//g, '\\') : real } : {}) } }
  })
  on('process.run', ($, e) => {
    const line = e.argv.join(' ')
    const at = longOf(e.init?.cwd ?? '').toLowerCase()
    if (at !== root.toLowerCase() && !at.startsWith(`${root.toLowerCase()}/`)) return ran(128, '')
    if (line.includes('rev-parse --show-toplevel')) return ran(0, `${root}\n`)
    if (line.includes('rev-parse --abbrev-ref HEAD')) return ran(0, 'main\n')
    if (line.includes('rev-parse --verify --quiet HEAD')) return ran(0, `${HASH}\n`)
    if (line.includes('status --porcelain')) return ran(0, changed.map(path => ` M ${path}\0`).join(''))
    if (line.includes('--numstat -z HEAD')) return ran(0, changed.map(path => `1\t1\t${path}\0`).join(''))
    return ran(1, '')
  })
  on('tool.call', ($, e) => {
    if (e.tool !== 'Edit') return { result: 'ok' }
    const rel = longOf(e.file_path).slice(root.length + 1)
    if (!changed.includes(rel)) changed.push(rel)
    return {
      result: {
        filePath: e.file_path,
        oldString: e.old_string,
        newString: e.new_string,
        originalFile: '',
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-before', '+after'] }],
        userModified: false,
        replaceAll: false,
      },
    }
  })
  let version = 0
  on('state.get', { plugin: 'agent-deck', key: 'snapshot' }, () => ({ value: { value: undefined, version } }))
  on('state.set', { plugin: 'agent-deck', key: 'snapshot' }, ($, e) => {
    saved.push(JSON.parse(JSON.stringify(e.value)) as DeckSnapshot)
    version += 1
    return { value: { isSet: true as const, version } }
  })
}

test('QA 1: a SendMessage and its delivery, which the receiver reads inside <agent-message from=…>, are logged once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  qaWorld(on, saved)

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.agent.spawn(named('fixer'))
  await $.agent.spawn(named('reviewer'))
  await $.session.send({ to: 'fixer', text: ASK, origin: { kind: 'model' }, agentId: 'agent-reviewer' })
  await $.session.receive({ origin: { kind: 'peer' }, text: `<agent-message from="reviewer">\n${ASK}\n</agent-message>`, agentId: 'agent-fixer' })
  await clock.advance(2000)

  const asked = lastOf(saved).data.messages.filter(message => message.kind === 'message')
  expect(asked.map(message => [message.from, message.to, message.text, message.isDelivered])).toEqual([['agent-reviewer', 'agent-fixer', ASK, true]])
})

test('QA 2: an agent that ends through SubagentHandback has its report as its result, though its turn answers ""', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  qaWorld(on, saved)

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.agent.spawn(named('fixer'))
  await $.tool.call(handback('agent-fixer', REPORT))
  await $.turn.complete({ turnId: 'turn-fixer', answer: '', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-fixer' })
  // its loop's last words at SubagentStop are no second result
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-fixer', agent_transcript_path: '', agent_type: 'general-purpose', last_assistant_message: 'Handing the report back.' })
  await clock.advance(2000)

  const data = lastOf(saved).data
  const fixer = M.agentOf(data, 'agent-fixer')
  expect([fixer?.status, fixer?.answer]).toEqual(['completed', REPORT])
  expect(data.messages.filter(message => message.kind === 'result').map(message => [message.from, message.to, message.text])).toEqual([['agent-fixer', M.MAIN, REPORT]])
})

test('QA 3: an edit spelled with an 8.3 short path (DEVELO~1) reads as git spells it: relative to the repository, and by its agent', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  qaWorld(on, saved, { root: 'C:/Users/developer/demo', short: 'C:/Users/DEVELO~1/demo' })

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:\\Users\\developer\\Documents' })
  await $.agent.spawn(named('fixer'))
  await $.tool.call(inLoop('agent-fixer', { tool: 'Edit' as const, file_path: 'C:\\Users\\DEVELO~1\\demo\\src\\token.js', old_string: 'before', new_string: 'after' }))
  await clock.advance(5000)

  const data = lastOf(saved).data
  expect(data.edits.map(edit => [edit.path, edit.abs])).toEqual([['src/token.js', 'C:/Users/developer/demo/src/token.js']])
  // what the Changes tab's "by fixer" reads: the agents that edited git's path
  expect(M.editorsOf(data, 'src/token.js').map(M.labelOf)).toEqual(['fixer'])
})

test('QA 5: a read in a directory spelled with an 8.3 short name (DEVELO~1) shows its file relative to the repository, never an absolute path cut from the left', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  qaWorld(on, saved, { root: 'C:/Users/developer/demo', short: 'C:/Users/DEVELO~1/demo' })

  // the session's cwd itself is the short spelling, as a temp folder's often is
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:\\Users\\DEVELO~1\\demo' })
  await clock.advance(1000)
  await $.agent.spawn(named('mapper'))
  await $.tool.call(inLoop('agent-mapper', { tool: 'Read' as const, file_path: 'C:\\Users\\DEVELO~1\\demo\\src\\token.js' }))
  await $.tool.call(inLoop('agent-mapper', { tool: 'Read' as const, file_path: 'C:\\Users\\DEVELO~1\\demo\\test\\token.test.js' }))
  await clock.advance(5000)

  const mapper = M.agentOf(lastOf(saved).data, 'agent-mapper')
  expect(mapper?.recent.map(one => one.target)).toEqual(['src/token.js', 'test/token.test.js'])
  expect(M.lastActionOf(mapper!)?.text).toBe('Read test/token.test.js')
})

test('QA 4: a name two agents carried (a reviewer finished, another spawned) resolves to the newest live one', async () => {
  const data = M.emptyData(NOW)
  data.agents.push(
    M.newAgent('a-old', 'agent', 'reviewer', NOW - 60_000, { status: 'completed', parentId: M.MAIN }),
    M.newAgent('a-new', 'agent', 'reviewer', NOW - 30_000, { status: 'running', parentId: M.MAIN }),
    M.newAgent('a-later', 'agent', 'reviewer', NOW - 10_000, { status: 'completed', parentId: M.MAIN }),
  )
  expect(M.resolveRecipient(data, 'reviewer')?.id).toBe('a-new')
  expect(M.resolveRecipient(data, 'Reviewer@team')?.id).toBe('a-new')
  // none live: the newest
  M.agentOf(data, 'a-new')!.status = 'completed'
  expect(M.resolveRecipient(data, 'reviewer')?.id).toBe('a-later')
  // two live: the newer
  M.agentOf(data, 'a-new')!.status = 'running'
  data.agents.push(M.newAgent('a-newest', 'agent', 'reviewer', NOW, { status: 'running', parentId: M.MAIN }))
  expect(M.resolveRecipient(data, 'reviewer')?.id).toBe('a-newest')
  // an id is that agent, whatever its name
  expect(M.resolveRecipient(data, 'a-old')?.id).toBe('a-old')
})
