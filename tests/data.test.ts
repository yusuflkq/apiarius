import type { Args, On } from 'claude-code'
import { expect, mock, test, type MockClock } from 'claude-code/testing'

import { emptyGit, type FileRow, type GitState } from '../hooks/git'
import * as M from '../hooks/model'
import type { DeckAgent, DeckData, DeckSnapshot } from '../types'

/**
 * The v3 data layer: goals, plans and their sources, checklists, placeholder
 * rows bound at spawn, labels, loops that fold away, files, the needs-you
 * line and the summary, snapshot healing, and the redraw policy. Each through
 * the hooks where the engine's events drive it, else through the model.
 */

const NOW = 1_700_000_100_000
const HASH = 'd'.repeat(40)

const SCRIPT = [
  'export const meta = {',
  "  name: 'find-flaky-tests',",
  "  description: 'Find flaky tests and propose fixes', // shown in the dialog",
  '  phases: [',
  "    { title: 'Scan', detail: 'grep test logs for retries' },",
  '    { title: "Fix", detail: `one agent per flaky test` },',
  '  ],',
  '}',
  "phase('Scan')",
  "const flaky = await agent('grep CI logs for retry markers', { schema: {} })",
].join('\n')

const PLAN = [
  '# Agent Deck v3',
  '',
  '## Context',
  '- The tree is hard to read',
  '- Names are long',
  '',
  '## Orchestration',
  '- **Phase A** (data): the model and its tests',
  '- **Phase B:** the outline',
  '  - nested detail that is not a step',
  '- **Phase C:** review',
  '',
  '```text',
  '1. not a step either',
  '```',
].join('\n')

type WorldOptions = {
  /** An Agent call answers this late on the mocked clock, so a test acts while it is in flight. */
  agentMs?: number
  /** A Bash call answers this late. */
  bashMs?: number
  /** Each Bash call's `bashEditDiff`, in turn. */
  bashDiffs?: unknown[]
  /** Agent calls refused, by tool_use_id. */
  refused?: string[]
  /** Counts `ui.invalidate`. */
  redraws?: { count: number }
  /** A Bash call that commits reports this sha (`gitOperation.commit.sha`). */
  commitSha?: string
}

/** A tool call made inside agent `agentId`'s loop, as the engine raises it there. */
function inLoop<T extends object>(agentId: string, call: T): T & { agentId: string } {
  return { ...call, agentId }
}

/** A call of a tool this build's table does not list (SubagentHandback). */
function untyped(call: Record<string, unknown>): Args<'tool.call'> {
  return call as unknown as Args<'tool.call'>
}

/**
 * Answers every engine call the deck makes, in Claude Code's place: git sees
 * /repo, a named spawn is `agent-<name>` and an unnamed one `agent-n<k>`,
 * and each tool answers as the real one does. `saved` collects each
 * snapshot the deck keeps in `$.state`.
 */
function world(on: On, clock: MockClock, saved: DeckSnapshot[], options: WorldOptions = {}) {
  let spawned = 0
  let taskId = 0
  const bashDiffs = [...(options.bashDiffs ?? [])]
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
  on('ui.invalidate', () => {
    if (options.redraws) options.redraws.count += 1
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } } }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', ($, e) => {
    spawned += 1
    return { model: 'claude-haiku', agentId: `agent-${e.name ?? `n${spawned}`}` }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('session.send', () => ({ isDelivered: true }))
  on('session.receive', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.SubagentStop', () => ({}))
  on('classic.UserPromptExpansion', () => ({}))
  on('classic.Notification', () => ({}))
  on('classic.TaskCreated', () => ({}))
  on('classic.TaskCompleted', () => ({}))
  on('classic.TeammateIdle', () => ({}))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 12, mtimeMs: NOW, isLink: false } }))
  on('fs.read', () => ({ value: '' }))
  on('process.run', ($, e) => {
    const line = e.argv.join(' ')
    if (line.includes('rev-parse --show-toplevel')) return ran(0, '/repo\n')
    if (line.includes('rev-parse --abbrev-ref HEAD')) return ran(0, 'main\n')
    if (line.includes('rev-parse --verify --quiet HEAD')) return ran(0, `${HASH}\n`)
    if (line.includes('status --porcelain')) return ran(0, ' M src/token.js\0')
    if (line.includes('--numstat -z HEAD')) return ran(0, '3\t1\tsrc/token.js\0')
    return ran(1, '')
  })
  on('tool.call', async ($, e) => {
    if (e.tool === 'Agent') {
      if (options.agentMs) await clock.sleep(options.agentMs)
      if (options.refused?.includes(e.tool_use_id)) return { deny: 'The person declined to start it' }
      return { result: { status: 'async_launched' as const, agentId: `agent-${e.name ?? 'bound'}`, description: e.description, prompt: e.prompt, outputFile: '' } }
    }
    if (e.tool === 'Bash') {
      if (options.bashMs) await clock.sleep(options.bashMs)
      const diff = bashDiffs.shift()
      const commit = options.commitSha && e.command.includes('git commit') ? { gitOperation: { commit: { sha: options.commitSha, kind: 'committed' as const } } } : {}
      return { result: { stdout: '', stderr: '', interrupted: false, ...(diff ? { bashEditDiff: diff as never } : {}), ...commit } }
    }
    if (e.tool === 'TodoWrite') return { result: { oldTodos: [], newTodos: e.todos } }
    if (e.tool === 'TaskCreate') {
      taskId += 1
      return { result: { task: { id: String(taskId), subject: e.subject } } }
    }
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: [] } }
    if (e.tool === 'ExitPlanMode') return { result: { plan: PLAN, isAgent: false } }
    if (e.tool === 'Workflow') return { result: { status: 'async_launched' as const, taskId: 'task-wf1', runId: 'wf_run1', workflowName: 'find-flaky-tests' } }
    if (e.tool === 'Edit') {
      return {
        result: {
          filePath: e.file_path,
          oldString: e.old_string,
          newString: e.new_string,
          originalFile: '',
          structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-a', '+b', '+c'] }],
          userModified: e.new_string.includes('(edited)'),
          replaceAll: false,
        },
      }
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

function lastOf(saved: readonly DeckSnapshot[]): DeckData {
  const last = saved[saved.length - 1]
  if (!last) throw new Error('the deck kept no snapshot')
  return last.data
}

function agentIn(data: DeckData, id: string): DeckAgent {
  const agent = M.agentOf(data, id)
  if (!agent) throw new Error(`no agent ${id}; agents: ${JSON.stringify(data.agents.map(one => one.id))}`)
  return agent
}

/** The spawn an Agent call raises; `parent` is the loop it is made in (the main loop's when absent). */
function spawnOf(options: { toolUseId: string; description: string; prompt?: string; name?: string; parent?: string; workflow?: string }) {
  return {
    tool_use_id: options.toolUseId,
    prompt: options.prompt ?? `${options.description}.`,
    description: options.description,
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-test',
    background: true,
    fork: false,
    ...(options.name ? { name: options.name } : {}),
    ...(options.parent ? { parentAgentId: options.parent } : {}),
    ...(options.workflow ? { workflow: { runId: options.workflow, agentIndex: 1 } } : {}),
  }
}

/** The person types `text` at the prompt (over the running turn `turnId`, when given). */
function typed(text: string, turnId?: string) {
  return { text, origin: { kind: 'composer' as const }, wait: false, ...(turnId ? { turnId } : {}) }
}

function todo(content: string, status: 'pending' | 'in_progress' | 'completed', activeForm = content) {
  return { content, status, activeForm }
}

/** A model-made spawn, as the hooks fold one in. */
function spawnInto(data: DeckData, at: number, options: { id: string; description: string; prompt?: string; name?: string; parent?: string }): DeckAgent {
  return M.noteSpawn(data, {
    toolUseId: `toolu_${options.id}`,
    agentId: options.id,
    parentId: options.parent ?? M.MAIN,
    ...(options.name ? { name: options.name } : {}),
    description: options.description,
    prompt: options.prompt ?? options.description,
    type: 'general-purpose',
    isTeammate: false,
    at,
  }).agent
}

function fileRow(path: string, added = 3, removed = 1): FileRow {
  return { path, code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added, removed }
}

function repoOf(files: FileRow[]): GitState {
  return {
    ...emptyGit(),
    isRepo: true,
    root: '/repo',
    checkedAt: NOW,
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  }
}

// Goals.

test('a turn a background agent`s notification starts is no prompt of yours, with or without a prompt.submit before it; the Orchestrator`s answer is kept as its report', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, clock, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })

  await $.prompt.submit(typed('Map the repository'))
  await $.turn.start({ text: 'Map the repository', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'The three agents are running in the background.', durationMs: 1000, isAborted: false, reason: 'answer' })
  // an agent finished while the session was idle: the engine starts the next turn with its notification, no prompt.submit first
  const notice = '<task-notification>\n<task-id>a13532ad0f987a4dc</task-id>\n<tool-use-id>toolu_01Y1</tool-use-id>\n<status>completed</status>\n</task-notification>'
  await $.turn.start({ text: notice, turnId: 't2' })
  await $.turn.complete({ turnId: 't2', answer: 'Summary: the map is done.\n\n- 7 files, tests run with node --test', durationMs: 1000, isAborted: false, reason: 'answer' })
  // and one queued while it was busy, which comes through prompt.submit
  await $.prompt.submit({ text: notice, origin: { kind: 'task-notification' }, wait: false })
  await $.turn.start({ text: notice, turnId: 't3' })
  // your own words that quote a notification further in stay yours
  await $.turn.start({ text: 'Why did I get this? <task-notification>x</task-notification>', turnId: 't4' })
  await clock.advance(2000)

  const data = lastOf(saved)
  expect(data.messages.filter(message => message.kind === 'prompt').map(message => message.text)).toEqual(['Map the repository', 'Why did I get this? <task-notification>x</task-notification>'])
  expect(agentIn(data, M.MAIN).answer).toBe('Summary: the map is done.\n\n- 7 files, tests run with node --test')
})

test('goals: the person`s own words start a goal while the session is idle with nothing live; typed mid-turn or while an agent runs they follow it up; the rest are events', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, clock, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })

  await $.prompt.submit(typed('Fix the token refresh bug\nIt adds SKEW_MS where it must subtract it.'))
  await $.turn.start({ text: 'Fix the token refresh bug', turnId: 't1' })
  // typed over the running turn
  await $.prompt.submit(typed('and add a test for it', 't1'))
  // a background task's notice and another plugin's own words are events
  await $.prompt.submit({ text: '<task-notification>done</task-notification>', origin: { kind: 'task-notification' }, wait: false })
  await $.prompt.submit({ text: 'The tally plugin sent a message', origin: { kind: 'plugin', name: 'tally' }, wait: false })
  await $.agent.spawn(spawnOf({ toolUseId: 'toolu_fixer', description: 'Fix the bug', name: 'fixer' }))
  await $.turn.complete({ turnId: 't1', answer: 'Started fixer.', durationMs: 1000, isAborted: false, reason: 'answer' })
  // idle, but fixer still runs: a follow-up (a plugin's prompt sent as the person's words counts)
  await $.prompt.submit({ text: 'make it quick', origin: { kind: 'plugin', name: 'agent-deck', asUser: true }, wait: false })
  await $.turn.complete({ turnId: 'turn-fixer', answer: 'Fixed.', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-fixer' })
  // idle with nothing live: a new goal, from a Remote Control client
  await $.prompt.submit({ text: 'Now update the README', origin: { kind: 'bridge' }, wait: false })
  // a slash command: its own words are the headline
  await $.classic.UserPromptExpansion({ expansion_type: 'slash_command', command_name: 'review', command_args: 'src/token.js', prompt: 'Review the changes in src/token.js for bugs.' })
  await $.prompt.submit(typed('Review the changes in src/token.js for bugs.'))
  await clock.advance(2000)

  const data = lastOf(saved)
  expect(data.goals.map(goal => [goal.headline, goal.origin, goal.followUps.map(one => one.text)])).toEqual([
    ['Fix the token refresh bug', 'composer', ['and add a test for it', 'make it quick']],
    ['Now update the README', 'bridge', []],
    ['/review src/token.js', 'composer', []],
  ])
  expect(M.goalOf(data)?.text).toBe('Review the changes in src/token.js for bugs.')
  // fixer was spawned under the first goal
  expect(agentIn(data, 'agent-fixer').goal).toBe(data.goals[0]?.id)
})

test('goals keep the newest 20, each with its newest 10 follow-ups; a headline is the first line, at most 80 characters; a new-goal press makes the next prompt one', () => {
  const data = M.emptyData(NOW)
  for (let i = 0; i < 25; i++) M.noteGoal(data, 'goal', { text: `Goal ${i}`, origin: 'composer', at: NOW + i })
  expect(data.goals.length).toBe(20)
  expect(data.goals[0]?.text).toBe('Goal 5')
  for (let i = 0; i < 12; i++) M.noteGoal(data, 'followUp', { text: `more ${i}`, origin: 'composer', at: NOW + 100 + i })
  expect(M.goalOf(data)?.followUps.map(one => one.text)).toEqual(Array.from({ length: 10 }, (_, i) => `more ${i + 2}`))

  expect(M.headlineOf('  \n**Make the deck readable**: plan, who does what\nand more')).toBe('Make the deck readable: plan, who does what')
  expect(M.headlineOf(`## ${'word '.repeat(40)}`).length).toBeLessThanOrEqual(80)

  // while the Orchestrator runs a prompt follows up; armed, it starts a goal
  M.agentOf(data, M.MAIN)!.status = 'running'
  expect(M.promptKindOf(data, { origin: { kind: 'composer' } })).toBe('followUp')
  M.armNewGoal(data)
  expect(M.promptKindOf(data, { origin: { kind: 'composer' } })).toBe('goal')
  M.noteGoal(data, 'goal', { text: 'A fresh start', origin: 'composer', at: NOW + 500 })
  expect(data.isNewGoalNext).toBeUndefined()
  expect(M.promptKindOf(data, { origin: { kind: 'scheduled-trigger' } })).toBe('event')

  // idle: a goal's workflow agent still at work keeps the next prompt a follow-up; the engine's housekeeping does not
  M.agentOf(data, M.MAIN)!.status = 'idle'
  const goal = M.goalOf(data)!
  const flow = M.ensureAgent(data, 'wf-1', NOW, 'workflow')
  flow.goal = goal.id
  expect(M.promptKindOf(data, { origin: { kind: 'composer' } })).toBe('followUp')
  flow.status = 'completed'
  const fork = M.ensureAgent(data, 'fork-1', NOW, 'engine')
  fork.goal = goal.id
  expect(M.promptKindOf(data, { origin: { kind: 'composer' } })).toBe('goal')
})

// Spawns.

test('an Agent call shows its agent at once, keyed by the call and labelled from its description; the spawn binds that same row; a refused call ends its row', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, clock, saved, { agentMs: 5000, refused: ['toolu_c'] })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.prompt.submit(typed('Make the deck readable'))
  await $.turn.start({ text: 'Make the deck readable', turnId: 't1' })

  const call = $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_a', description: 'Phase A: data, banner', prompt: 'Build the data layer.' })
  await clock.advance(2000)
  let data = lastOf(saved)
  expect(data.agents.map(agent => agent.id)).toEqual([M.YOU, M.MAIN, 'toolu_a'])
  const row = agentIn(data, 'toolu_a')
  expect([row.status, M.statusOf(row), M.labelOf(row), M.scopeOf(row), row.parentId, M.isPlaceholder(row)]).toEqual(['starting', 'running', 'Phase A', 'data, banner', M.MAIN, true])
  expect(row.goal).toBe(data.goals[0]?.id)

  // the spawn the call raises binds the row: its place and label kept, the agent's id, never a second row
  await $.agent.spawn(spawnOf({ toolUseId: 'toolu_a', description: 'Phase A: data, banner', prompt: 'Build the data layer.' }))
  await clock.advance(2000)
  data = lastOf(saved)
  expect(data.agents.map(agent => agent.id)).toEqual([M.YOU, M.MAIN, 'agent-n1'])
  const bound = agentIn(data, 'agent-n1')
  expect([bound.status, M.labelOf(bound), bound.toolUseId, M.isPlaceholder(bound)]).toEqual(['running', 'Phase A', 'toolu_a', false])
  expect(data.messages.filter(message => message.kind === 'spawn').map(message => [message.from, message.to])).toEqual([[M.MAIN, 'agent-n1']])
  await clock.advance(2000)
  await call

  // a sibling with the same marker is "Phase A 2"; a refused call's row ends, saying why
  const second = $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_b', description: 'Phase A: tests', prompt: 'Write the tests.' })
  const refused = $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_c', description: 'Phase C: review', prompt: 'Review it.' })
  await clock.advance(2000)
  expect(M.labelOf(agentIn(lastOf(saved), 'toolu_b'))).toBe('Phase A 2')
  await clock.advance(4000)
  await second
  await refused
  await clock.advance(2000)
  data = lastOf(saved)
  // the second call's result named its agent: no spawn was told, the row is bound by the call
  expect(data.agents.map(agent => agent.id)).toEqual([M.YOU, M.MAIN, 'agent-n1', 'agent-bound', 'toolu_c'])
  const stopped = agentIn(data, 'toolu_c')
  expect([stopped.status, stopped.answer]).toEqual(['killed', 'Not started: The person declined to start it'])
})

test('labels: the name, else the description`s marker (its scope after), else the description cut at a word; at most 18 characters (24 when that keeps little), fixed at spawn, never an id', () => {
  const data = M.emptyData(NOW)
  const scout = spawnInto(data, NOW, { id: 'a1', name: 'scout', description: 'Find the token bug' })
  expect([M.labelOf(scout), M.scopeOf(scout)]).toEqual(['scout', 'Find the token bug'])
  const phaseA = spawnInto(data, NOW, { id: 'a2', description: 'Phase A: data, banner, redraw policy' })
  expect([M.labelOf(phaseA), M.scopeOf(phaseA)]).toEqual(['Phase A', 'data, banner, redraw policy'])
  // the cut at 18, "Investigate the", would end on a hanging word, and "Investigate" alone is one word: it runs on to 24
  const long = spawnInto(data, NOW, { id: 'a3', description: 'Investigate the flaky refresh test suite' })
  expect([M.labelOf(long), M.scopeOf(long)]).toEqual(['Investigate the flaky', 'Investigate the flaky refresh test suite'])
  // siblings: " 2", " 3"; a sub-agent of Phase A is no sibling of it
  expect(M.labelOf(spawnInto(data, NOW, { id: 'a4', description: 'Phase A: tests' }))).toBe('Phase A 2')
  expect(M.labelOf(spawnInto(data, NOW, { id: 'a5', description: 'Phase A - docs' }))).toBe('Phase A 3')
  expect(M.labelOf(spawnInto(data, NOW, { id: 'a6', description: 'Phase A: helper', parent: 'a2' }))).toBe('Phase A')
  // one long word is cut with an ellipsis
  const word = spawnInto(data, NOW, { id: 'a7', name: 'a-very-long-agent-name-indeed', description: '' })
  expect(M.labelOf(word)).toBe('a-very-long-agent…')
  for (const agent of data.agents) expect(Array.from(M.labelOf(agent)).length).toBeLessThanOrEqual(M.LIMITS.labelStretch)
  // fixed: a later description leaves it
  phaseA.description = 'Something else entirely'
  expect(M.labelOf(phaseA)).toBe('Phase A')
  // nothing to go on: never the id
  const loop = M.ensureAgent(data, 'agent-0123456789abcdef', NOW)
  expect(M.labelOf(loop)).toBe('Agent')
  expect(M.labelOf(M.ensureAgent(data, 'fork-1', NOW, 'engine'))).toBe('Housekeeping')
  expect(M.labelOf(M.agentOf(data, M.MAIN)!)).toBe('Orchestrator')
  expect(M.cutAtWord('Fix the token refresh bug', 18)).toBe('Fix the token')
  expect(M.splitMarker('Read https://example.com/a: b')).toBeUndefined()
})

test('a label never ends on a word that leaves its phrase hanging, runs on to 24 characters when 18 keep one word or very little, and a name that fits stays as it is', () => {
  const data = M.emptyData(NOW)
  const hanging = /\s(?:and|or|the|a|an|of|to|for|with|in|on|from|into|by|as)$/i
  // the old cut made "Recover goal and": the hanging "and" goes, and two words of twelve characters are enough
  const recover = spawnInto(data, NOW, { id: 'b1', description: 'Recover goal and results on startup' })
  expect([M.labelOf(recover), M.scopeOf(recover)]).toEqual(['Recover goal', 'Recover goal and results on startup'])
  expect(M.labelOf(spawnInto(data, NOW, { id: 'b2', description: 'Fix the bug in the parser module' }))).toBe('Fix the bug')
  expect(M.labelOf(spawnInto(data, NOW, { id: 'b3', description: 'Polish labels, results, and docs' }))).toBe('Polish labels')
  // one word, or under ten characters, at 18: the cut may run on to 24, still never on a hanging word
  expect(M.labelOf(spawnInto(data, NOW, { id: 'b4', description: 'Investigate flakiness' }))).toBe('Investigate flakiness')
  expect(M.labelOf(spawnInto(data, NOW, { id: 'b5', description: 'Review PR for security issues' }))).toBe('Review PR for security')
  expect(M.labelOf(spawnInto(data, NOW, { id: 'b6', description: 'Fix CI in the monorepo build pipeline' }))).toBe('Fix CI in the monorepo')
  // a sibling's " 2" fits inside the same 24
  expect(M.labelOf(spawnInto(data, NOW, { id: 'b7', description: 'Review PR for security fixes' }))).toBe('Review PR for security 2')
  for (const agent of data.agents.filter(one => one.kind === 'agent')) {
    const label = M.labelOf(agent)
    expect(hanging.test(label)).toBe(false)
    expect(Array.from(label).length).toBeLessThanOrEqual(M.LIMITS.labelStretch)
  }
  // a name that fits is the label unchanged, whatever its last word; the description is its scope
  const named = spawnInto(data, NOW, { id: 'b8', name: 'log in', description: 'Recover goal and results on startup' })
  expect([M.labelOf(named), M.scopeOf(named)]).toEqual(['log in', 'Recover goal and results on startup'])
  expect(M.labelOf(spawnInto(data, NOW, { id: 'b9', name: 'v3 design review', description: 'Review v3 against the system' }))).toBe('v3 design review')
  // a drawing's narrower column cuts a label the same way, a sibling's number kept
  expect(M.fitLabel('Recover goal and results', 20)).toBe('Recover goal')
  expect(M.fitLabel('Review PR for security 2', 18)).toBe('Review PR 2')
  expect(M.fitLabel('scout', 18)).toBe('scout')
})

// Loops that fold away.

test('loops with no spawn fold away: the engine`s housekeeping, and a Workflow`s agents while its run is live; its phases are the plan', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, clock, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.prompt.submit(typed('Find the flaky tests'))
  await $.turn.start({ text: 'Find the flaky tests', turnId: 't1' })

  // a compaction fork's call: no spawn, no workflow running
  await $.tool.call(inLoop('fork-compact', { tool: 'Read' as const, file_path: '/repo/src/a.ts' }))
  // the Orchestrator starts a workflow: loops seen now are its agents
  await $.tool.call({ tool: 'Workflow', tool_use_id: 'toolu_wf', script: SCRIPT })
  await $.tool.call(inLoop('wf-loop-1', { tool: 'Grep' as const, pattern: 'retry' }))
  await $.agent.spawn(spawnOf({ toolUseId: 'toolu_wf', description: 'Scan the CI logs', workflow: 'wf_run1' }))
  await clock.advance(2000)

  let data = lastOf(saved)
  expect(['fork-compact', 'wf-loop-1', 'agent-n1'].map(id => M.originOf(agentIn(data, id)))).toEqual(['engine', 'workflow', 'workflow'])
  expect(M.childrenOf(data, M.MAIN)).toEqual([])
  expect(M.hasLiveAgents(data)).toBe(false)
  expect(M.foldOf(data)).toEqual({ ids: ['fork-compact', 'wf-loop-1', 'agent-n1'], live: 3, workflow: 2, engine: 1, text: '2 workflow agents · 1 housekeeping loop · 3 running' })
  expect(data.workflows.map(run => [run.name, run.phases, run.runId, run.taskId])).toEqual([['find-flaky-tests', ['Scan', 'Fix'], 'wf_run1', 'task-wf1']])
  const plan = M.planOf(data)
  expect([plan.source, plan.steps.map(step => [step.key, step.text, step.status])]).toEqual([
    'workflow',
    [
      ['phase:1', 'Scan', 'active'],
      ['phase:2', 'Fix', 'pending'],
    ],
  ])
  // no hand-off line for each of a workflow's agents
  expect(data.messages.filter(message => message.kind === 'spawn')).toEqual([])

  // the run's notice ends it: a loop seen after is housekeeping again
  await $.prompt.submit({ text: 'Task task-wf1 (find-flaky-tests) completed', origin: { kind: 'task-notification' }, wait: false })
  await $.tool.call(inLoop('fork-memory', { tool: 'Read' as const, file_path: '/repo/src/b.ts' }))
  // a row taken for housekeeping whose spawn arrives after its first call is a real agent
  await $.tool.call(inLoop('agent-late', { tool: 'Read' as const, file_path: '/repo/src/c.ts' }))
  await $.agent.spawn(spawnOf({ toolUseId: 'toolu_late', description: 'Check late', name: 'late' }))
  await clock.advance(2000)
  data = lastOf(saved)
  expect([M.originOf(agentIn(data, 'fork-memory')), M.originOf(agentIn(data, 'agent-late'))]).toEqual(['engine', 'agent'])
  expect(M.childrenOf(data, M.MAIN)).toEqual(['agent-late'])
})

// Plans.

test('the plan comes from the first source that has steps: the board, the Orchestrator`s todos, the approved plan, a Workflow`s phases, each Agent call', () => {
  const data = M.emptyData(NOW)
  const main = M.agentOf(data, M.MAIN)!
  M.noteGoal(data, 'goal', { text: 'Make the deck readable', origin: 'composer', at: NOW })
  expect(M.planOf(data)).toEqual({ source: 'none', goal: data.goals[0]?.id, steps: [], unlinked: [], links: {} })

  // 5. each Agent call is a step, with its agent's state
  const scout = spawnInto(data, NOW + 1, { id: 'agent-scout', name: 'scout', description: 'Find the token bug' })
  expect(M.planOf(data)).toMatchObject({ source: 'implicit', steps: [{ key: 'agent:agent-scout', text: 'Find the token bug', status: 'active', agents: ['agent-scout'] }] })
  scout.status = 'completed'
  expect(M.planOf(data).steps[0]?.status).toBe('done')

  // 4. a Workflow's phases
  M.noteWorkflow(data, { id: 'toolu_wf', caller: M.MAIN, name: 'flow', phases: ['Scan', 'Fix'], at: NOW + 2 })
  expect(M.planOf(data)).toMatchObject({ source: 'workflow', steps: [{ key: 'phase:1', text: 'Scan' }, { key: 'phase:2', text: 'Fix' }] })

  // 3. the approved plan, from its section that names the steps
  expect(M.notePlan(data, PLAN, NOW + 3)).toBe(true)
  expect(M.planOf(data).source).toBe('plan')
  expect(M.planOf(data).steps.map(step => step.text)).toEqual(['Phase A (data): the model and its tests', 'Phase B: the outline', 'Phase C: review'])

  // 2. the Orchestrator's TodoWrite: the whole list from the result
  const todos = [todo('Read the deck', 'completed'), todo('Build the outline view', 'in_progress', 'Building the outline view'), todo('Review and test', 'pending')]
  M.noteTodo(data, main, 'TodoWrite', { todos: todos.slice(0, 1) }, { oldTodos: [], newTodos: todos }, NOW + 4)
  expect(M.planOf(data)).toMatchObject({
    source: 'todo',
    steps: [
      { text: 'Read the deck', status: 'done' },
      { text: 'Build the outline view', status: 'active' },
      { text: 'Review and test', status: 'pending' },
    ],
  })

  // 1. the task board
  M.noteBoard(data, main, 'TaskCreate', { subject: 'Build the outline view', description: 'rows, folds, zoom' }, { task: { id: '1', subject: 'Build the outline view' } }, NOW + 5)
  M.noteBoard(data, main, 'TaskCreate', { subject: 'Ship it', description: 'commit and move' }, { task: { id: '2', subject: 'Ship it' } }, NOW + 5)
  M.noteBoard(data, main, 'TaskUpdate', { taskId: '1', status: 'in_progress' }, { success: true, taskId: '1', updatedFields: ['status'] }, NOW + 6)
  expect(M.planOf(data)).toMatchObject({
    source: 'board',
    steps: [
      { key: 'task:1', text: 'Build the outline view', status: 'active' },
      { key: 'task:2', text: 'Ship it', status: 'pending' },
    ],
  })
  // a deleted task leaves the board
  M.noteBoard(data, main, 'TaskUpdate', { taskId: '2', status: 'deleted' }, { success: true, taskId: '2', updatedFields: ['status'] }, NOW + 7)
  expect(M.planOf(data).steps.map(step => step.key)).toEqual(['task:1'])
})

test('plan steps are split from a plan`s markdown, and a Workflow script`s meta literal is read with its comments and quotes', () => {
  expect(M.planStepsOf('# Plan\n\n1. Read the code\n2. Fix `needsRefresh()`\n   - detail\n3. [Test it](https://x.y)\n\n## Verify\n1. later list')).toEqual([
    'Read the code',
    'Fix needsRefresh()',
    'Test it',
  ])
  expect(M.planStepsOf('# Title\n## Step 1: data\ntext\n## Step 2: outline\ntext')).toEqual(['Step 1: data', 'Step 2: outline'])
  expect(M.planStepsOf('# Title\n## Context\n- one\n- two\n## Steps\n### Build\n### Test\n')).toEqual(['Build', 'Test'])
  expect(M.planStepsOf('just one line')).toEqual([])
  expect(M.workflowMetaOf(SCRIPT)).toEqual({ name: 'find-flaky-tests', description: 'Find flaky tests and propose fixes', phases: ['Scan', 'Fix'] })
  expect(M.workflowMetaOf("export const meta = { name: 'x', phases: ['A', 'B'] }")?.phases).toEqual(['A', 'B'])
  expect(M.workflowMetaOf('export const meta = { name: makeName() }')).toBeUndefined()
  expect(M.workflowMetaOf('no meta here')).toBeUndefined()
})

test('each of the Orchestrator`s agents is tied to one step, saying how: owner, self, mention, during, words; a sub-agent takes its parent`s', () => {
  // the Orchestrator's todos: during, mention by words, mention by number, inherited, unlinked
  const data = M.emptyData(NOW)
  const main = M.agentOf(data, M.MAIN)!
  M.noteGoal(data, 'goal', { text: 'Make the deck readable', origin: 'composer', at: NOW })
  const list = [todo('Read the deck', 'completed'), todo('Build the outline view', 'in_progress'), todo('Write the model tests', 'pending'), todo('Review and ship', 'pending')]
  M.noteTodo(data, main, 'TodoWrite', { todos: list }, { oldTodos: [], newTodos: list }, NOW + 1)
  const during = spawnInto(data, NOW + 2, { id: 'a-during', description: 'Phase A: data, banner', prompt: 'Keep each full todo list.' })
  const words = spawnInto(data, NOW + 3, { id: 'a-mention', description: 'Write the model tests', prompt: 'Cover the queries.' })
  const numbered = spawnInto(data, NOW + 4, { id: 'a-number', description: 'Final pass', prompt: 'Do step 4 when the rest is in.' })
  const helper = spawnInto(data, NOW + 5, { id: 'a-helper', description: 'Look things up', parent: 'a-during' })
  // with two items in progress, no 'during'
  M.noteTodo(data, main, 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: list.map(one => ({ ...one, status: 'in_progress' as const })) }, NOW + 6)
  const loose = spawnInto(data, NOW + 7, { id: 'a-loose', description: 'Tidy imports', prompt: 'Sort them.' })
  M.noteTodo(data, main, 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: list }, NOW + 8)

  let plan = M.planOf(data)
  expect(plan.source).toBe('todo')
  expect(plan.links[during.id]).toMatchObject({ how: 'during', sure: 0.7, isInherited: false, key: plan.steps[1]?.key })
  expect(plan.links[words.id]).toMatchObject({ how: 'mention', key: plan.steps[2]?.key })
  expect(plan.links[numbered.id]).toMatchObject({ how: 'mention', key: plan.steps[3]?.key })
  expect(plan.links[helper.id]).toMatchObject({ how: 'during', isInherited: true, key: plan.steps[1]?.key })
  expect(plan.links[loose.id]).toBeUndefined()
  expect(plan.unlinked).toEqual([loose.id])
  // a step lists the Orchestrator's own agents; the helper nests under its parent
  expect(plan.steps.map(step => step.agents)).toEqual([[], [during.id], [words.id], [numbered.id]])

  // the board: owner, self, words
  const board = M.emptyData(NOW)
  const lead = M.agentOf(board, M.MAIN)!
  M.noteGoal(board, 'goal', { text: 'Fix the token refresh', origin: 'composer', at: NOW })
  const created = (id: string, subject: string) => M.noteBoard(board, lead, 'TaskCreate', { subject, description: subject }, { task: { id, subject } }, NOW + 1)
  created('1', 'Fix needsRefresh in token.js')
  created('2', 'Add regression tests')
  created('3', 'Update the README refresh section')
  const fixer = spawnInto(board, NOW + 2, { id: 'b-fixer', name: 'fixer', description: 'Token work' })
  const tester = spawnInto(board, NOW + 3, { id: 'b-tester', description: 'QA', prompt: 'Make sure it holds.' })
  const docs = spawnInto(board, NOW + 4, { id: 'b-docs', description: 'README refresh section notes' })
  M.noteBoard(board, lead, 'TaskUpdate', { taskId: '1', owner: 'fixer' }, { success: true, taskId: '1', updatedFields: ['owner'] }, NOW + 5)
  M.noteBoard(board, tester, 'TaskUpdate', { taskId: '2', status: 'in_progress' }, { success: true, taskId: '2', updatedFields: ['status'] }, NOW + 6)
  plan = M.planOf(board)
  expect([plan.links[fixer.id]?.how, plan.links[fixer.id]?.key, plan.links[fixer.id]?.sure]).toEqual(['owner', 'task:1', 1])
  expect([plan.links[tester.id]?.how, plan.links[tester.id]?.key]).toEqual(['self', 'task:2'])
  expect([plan.links[docs.id]?.how, plan.links[docs.id]?.key]).toEqual(['words', 'task:3'])
  expect((plan.links[docs.id]?.sure ?? 1) <= 0.5).toBe(true)
  // a step whose agents all ended with one failed, never done, is failed
  tester.status = 'failed'
  expect(M.planOf(board).steps[1]?.status).toBe('failed')
  expect(M.stepLinkOf(board, fixer.id)?.how).toBe('owner')
})

// Checklists.

test('each agent keeps its whole todo list: done of total, the step in hand steady across its calls, the last call dimmed when it ends, and when each item started and ended', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, clock, saved, { bashMs: 5000 })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.agent.spawn(spawnOf({ toolUseId: 'toolu_fixer', description: 'Fix the bug', name: 'fixer' }))
  const first = [todo('Read the code', 'completed', 'Reading the code'), todo('Fix the bug', 'in_progress', 'Fixing the bug'), todo('Run the tests', 'pending', 'Running the tests')]
  await $.tool.call(inLoop('agent-fixer', { tool: 'TodoWrite' as const, todos: first }))
  await clock.advance(60_000)

  // a call in flight: it is the last action, live; the step does not move
  const call = $.tool.call(inLoop('agent-fixer', { tool: 'Bash' as const, command: 'npm test', description: 'Run the unit tests' }))
  await clock.advance(2000)
  let fixer = agentIn(lastOf(saved), 'agent-fixer')
  expect(M.lastActionOf(fixer)).toEqual({ text: 'Run the unit tests', tool: 'Bash', at: NOW + 60_000, isLive: true })
  expect(M.stepOf(fixer)).toBe('Fixing the bug')
  await clock.advance(4000)
  await call
  await clock.advance(2000)
  fixer = agentIn(lastOf(saved), 'agent-fixer')
  // ended: dimmed, not cleared
  expect(M.lastActionOf(fixer)).toEqual({ text: 'Run the unit tests', tool: 'Bash', at: NOW + 60_000, isLive: false, ok: true })
  expect(M.stepOf(fixer)).toBe('Fixing the bug')
  const list = M.checklistOf(fixer)
  expect([list.done, list.total]).toEqual([1, 3])
  expect(list.items.map(item => [item.text, item.status, item.doing])).toEqual([
    ['Read the code', 'done', 'Reading the code'],
    ['Fix the bug', 'active', 'Fixing the bug'],
    ['Run the tests', 'pending', 'Running the tests'],
  ])
  const keys = list.items.map(item => item.key)

  // the list rewritten: keys and starts kept by content, the fix done, the tests started
  const second = [todo('Read the code', 'completed'), todo('Fix the bug', 'completed'), todo('Run the tests', 'in_progress', 'Running the tests')]
  await $.tool.call(inLoop('agent-fixer', { tool: 'TodoWrite' as const, todos: second }))
  await clock.advance(2000)
  fixer = agentIn(lastOf(saved), 'agent-fixer')
  const next = M.checklistOf(fixer)
  expect(next.items.map(item => item.key)).toEqual(keys)
  expect([next.done, next.total, M.stepOf(fixer)]).toEqual([2, 3, 'Running the tests'])
  expect(next.items[1]).toMatchObject({ status: 'done', startedAt: NOW, doneAt: NOW + 68_000 })
  expect(next.items[2]).toMatchObject({ status: 'active', startedAt: NOW + 68_000 })
  // once it ends, the step is no longer "now"
  await $.turn.complete({ turnId: 'turn-fixer', answer: 'Fixed.', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-fixer' })
  await clock.advance(2000)
  expect(M.stepOf(agentIn(lastOf(saved), 'agent-fixer'))).toBe('')
  expect(M.checklistOf(agentIn(lastOf(saved), 'agent-fixer')).done).toBe(2)
})

// Files.

test('files: who edited each, whether one of them is at it, and shared when two agents edited it while both were live', () => {
  const data = M.emptyData(NOW - 600_000)
  const alpha = spawnInto(data, NOW - 100_000, { id: 'f-alpha', name: 'alpha', description: 'one' })
  const beta = spawnInto(data, NOW - 50_000, { id: 'f-beta', name: 'beta', description: 'two' })
  const gamma = spawnInto(data, NOW - 300_000, { id: 'f-gamma', name: 'gamma', description: 'three' })
  Object.assign(gamma, { status: 'completed', endedAt: NOW - 200_000 })
  const edit = (agent: DeckAgent, path: string, at: number) =>
    M.addEdit(data, agent, { id: `${agent.id}-${at}`, agent: agent.id, tool: 'Edit', path, abs: `/repo/${path}`, at, added: 2, removed: 1, patch: '', isNew: false })
  edit(alpha, 'src/model.ts', NOW - 40_000)
  edit(beta, 'src/model.ts', NOW - 30_000)
  edit(gamma, 'src/old.ts', NOW - 250_000)
  edit(alpha, 'src/old.ts', NOW - 20_000)

  expect(M.filesOf(data).map(file => [file.path, file.editors, file.live, file.isShared, file.added, file.removed])).toEqual([
    ['src/old.ts', ['f-gamma', 'f-alpha'], true, false, 4, 2],
    ['src/model.ts', ['f-alpha', 'f-beta'], true, true, 4, 2],
  ])
  expect(M.needsOf(data, repoOf([fileRow('src/model.ts')]))).toEqual({ tone: 'attention', kind: 'shared', text: 'alpha and beta both edit src/model.ts', agentId: 'f-beta', path: 'src/model.ts' })

  // once one of them is done the file stays shared, but no longer needs you
  Object.assign(beta, { status: 'completed', endedAt: NOW - 10_000 })
  expect(M.filesOf(data).find(file => file.path === 'src/model.ts')?.isShared).toBe(true)
  expect(M.needsOf(data, repoOf([fileRow('src/model.ts')])).kind).not.toBe('shared')
  Object.assign(alpha, { status: 'completed', endedAt: NOW - 5_000 })
  expect(M.filesOf(data).map(file => file.live)).toEqual([false, false])
})

test('a Bash command`s bashEditDiff records each file it changed with its hunks; an Edit the person changed before accepting says so', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  const hunk = { oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+export const a = 1', '+export const b = 2'] }
  world(on, clock, saved, {
    bashDiffs: [
      { files: [{ filePath: '/repo/src/gen.ts', hunks: [hunk], created: true }, { filePath: '/repo/README.md', hunks: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-old', '+new'] }] }], moreFiles: 0 },
      { files: [], moreFiles: 0, unavailable: true },
    ],
  })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await clock.advance(1000)
  await $.agent.spawn(spawnOf({ toolUseId: 'toolu_fixer', description: 'Generate', name: 'fixer' }))
  await $.tool.call(inLoop('agent-fixer', { tool: 'Bash' as const, command: 'npm run gen', description: 'Generate the client' }))
  await clock.advance(1000)
  await $.tool.call(inLoop('agent-fixer', { tool: 'Bash' as const, command: 'npm run gen', description: 'Generate it again' }))
  await clock.advance(1000)
  await $.tool.call(inLoop('agent-fixer', { tool: 'Edit' as const, file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b (edited)' }))
  await clock.advance(3000)

  const data = lastOf(saved)
  expect(data.edits.map(edit => [edit.tool, edit.path, edit.added, edit.removed, edit.isNew, edit.userModified ?? false])).toEqual([
    ['Bash', 'src/gen.ts', 2, 0, true, false],
    ['Bash', 'README.md', 1, 1, false, false],
    ['Edit', 'src/app.ts', 2, 1, false, true],
  ])
  expect(data.edits[0]?.patch).toContain('+export const a = 1')
  expect(M.filesOf(data).map(file => [file.path, file.editors, file.userModified, file.isNew])).toEqual([
    ['src/app.ts', ['agent-fixer'], true, false],
    ['README.md', ['agent-fixer'], false, false],
    ['src/gen.ts', ['agent-fixer'], false, true],
  ])
})

// The header.

test('the needs-you line: a prompt blocked on you, then a failure, then a file two running agents share; else all done with files to review, else nothing', () => {
  const data = M.emptyData(NOW - 600_000)
  M.noteGoal(data, 'goal', { text: 'Fix the token refresh', origin: 'composer', at: NOW - 600_000 })
  const fixer = spawnInto(data, NOW - 500_000, { id: 'n-fixer', name: 'fixer', description: 'Fix it' })
  const tester = spawnInto(data, NOW - 400_000, { id: 'n-tester', name: 'tester', description: 'Test it' })
  const reviewer = spawnInto(data, NOW - 300_000, { id: 'n-reviewer', name: 'reviewer', description: 'Review it' })
  for (const agent of [fixer, tester]) M.addEdit(data, agent, { id: `e-${agent.id}`, agent: agent.id, tool: 'Edit', path: 'src/token.js', abs: '/repo/src/token.js', at: NOW - 60_000, added: 1, removed: 1, patch: '', isNew: false })
  Object.assign(reviewer, { status: 'failed', endedAt: NOW - 100_000, answer: 'Tests still fail in token.test.js' })
  M.beginTool(data, fixer, M.activityOf('t-bash', 'Bash', { command: 'npm test', description: 'Run the unit tests' }, '/repo', NOW - 10_000))
  M.noteNeeds(data, { kind: 'permission_prompt', text: 'Claude needs your permission to use Bash', at: NOW - 5_000 })
  const git = repoOf([fileRow('src/token.js')])

  expect(M.needsOf(data, git)).toEqual({ tone: 'attention', kind: 'blocked', text: 'fixer waits on you: allow Bash "npm test"', agentId: 'n-fixer' })
  expect(M.statusOf(fixer, data)).toBe('waiting')
  expect(M.statusOf(M.agentOf(data, M.MAIN)!, data)).toBe('idle')
  expect(M.summaryOf(data, git, NOW)).toEqual({ step: '1 of 3', running: 1, waiting: 1, done: 0, failed: 1, files: 1, added: 3, removed: 1, minutes: 10 })

  M.endTool(fixer, 't-bash', true, NOW)
  M.clearNeeds(data, { kind: 'end', agent: fixer.id, call: 't-bash' })
  expect(M.needsOf(data, git)).toEqual({ tone: 'alert', kind: 'failed', text: 'reviewer failed: Tests still fail in token.test.js', agentId: 'n-reviewer' })
  Object.assign(reviewer, { status: 'completed' })
  expect(M.needsOf(data, git)).toMatchObject({ tone: 'attention', kind: 'shared', text: 'fixer and tester both edit src/token.js' })
  // waiting for your input is no block
  M.noteNeeds(data, { kind: 'idle_prompt', text: 'Claude is waiting for your input', at: NOW })
  expect(M.needsOf(data, git).kind).toBe('shared')
  for (const agent of [fixer, tester]) Object.assign(agent, { status: 'completed', endedAt: NOW })
  expect(M.needsOf(data, git)).toEqual({ tone: 'done', kind: 'review', text: 'All done · 1 file to review' })
  expect(M.needsOf(data, repoOf([]))).toEqual({ tone: 'quiet', kind: 'none', text: 'Nothing needs you' })
  // outside a repository, the files agents edited
  expect(M.needsOf(data, { ...emptyGit(), isRepo: false }).text).toBe('All done · 1 file to review')
  const done = M.summaryOf(data, git, NOW + 3_600_000)
  expect([done.step, done.running, done.done, done.minutes]).toEqual(['3 of 3', 0, 3, 10])
})

test('the summary`s step is the plan`s step in progress, else the steps done; its minutes run while work goes on', () => {
  const data = M.emptyData(NOW)
  const main = M.agentOf(data, M.MAIN)!
  expect(M.summaryOf(data, repoOf([]), NOW)).toEqual({ step: '', running: 0, waiting: 0, done: 0, failed: 0, files: 0, added: 0, removed: 0, minutes: 0 })
  M.noteGoal(data, 'goal', { text: 'Ship it', origin: 'composer', at: NOW })
  const list = [todo('One', 'completed'), todo('Two', 'completed'), todo('Three', 'in_progress'), todo('Four', 'pending')]
  M.noteTodo(data, main, 'TodoWrite', { todos: list }, { oldTodos: [], newTodos: list }, NOW + 1)
  main.status = 'running'
  expect(M.summaryOf(data, repoOf([]), NOW + 125_000)).toMatchObject({ step: '3 of 4', minutes: 2 })
  main.status = 'idle'
  main.lastAt = NOW + 60_000
  expect(M.summaryOf(data, repoOf([]), NOW + 125_000)).toMatchObject({ step: '3 of 4', minutes: 1 })
})

// Snapshots.

test('an older snapshot heals field by field: new fields take their defaults, wrong shapes are dropped, caps hold, and agents get their labels', () => {
  const base = M.emptyData(NOW)
  const older = {
    ...base,
    agents: [
      ...base.agents,
      { ...M.newAgent('old-1', 'agent', 'agent-old-1', NOW, { description: 'Phase B: outline', parentId: M.MAIN, status: 'running' }), origin: 'nonsense', label: 7 },
      { ...M.newAgent('old-2', 'agent', 'scout', NOW, { parentId: M.MAIN, status: 'completed' }), todos: Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, text: `item ${i}`, status: 'pending' })) },
    ],
    goals: [...Array.from({ length: 25 }, (_, i) => ({ id: `g${i}`, headline: `Goal ${i}`, text: `Goal ${i}`, at: NOW + i, followUps: [] })), { id: 'bad' }],
    board: { x: { id: 'x', subject: 's', status: 'weird' }, '1': { id: '1', subject: 'ok', status: 'done', at: NOW } },
    files: 'nope',
    workflows: [{ id: 'w', caller: M.MAIN, startedAt: NOW, phases: ['A', 7] }],
  }
  const { goals: _goals, ...noGoals } = older
  void _goals

  const healed = M.healData(JSON.parse(JSON.stringify(older)) as DeckData, NOW)
  expect(healed.goals.map(goal => goal.id)).toEqual(Array.from({ length: 20 }, (_, i) => `g${i + 5}`))
  expect(healed.goals[0]?.origin).toBe('composer')
  expect(Object.keys(healed.board)).toEqual(['1'])
  expect(healed.files).toEqual({})
  expect(healed.workflows.map(run => [run.id, run.phases, run.lastAt])).toEqual([['w', ['A'], NOW]])
  const first = agentIn(healed, 'old-1')
  expect([first.origin, M.labelOf(first), M.scopeOf(first)]).toEqual([undefined, 'Phase B', 'outline'])
  expect(agentIn(healed, 'old-2').todos?.length).toBe(50)
  expect(M.labelOf(agentIn(healed, 'old-2'))).toBe('scout')
  // a snapshot from before goals, the board and files: empty ones, and JSON with nothing undefined
  const bare = M.healData(JSON.parse(JSON.stringify(noGoals)) as DeckData, NOW)
  expect(bare.goals).toEqual([])
  expect(JSON.parse(JSON.stringify(bare))).toEqual(bare)
  expect(M.healView({ folded: ['a', 7, 'a', ''], zoom: 'step:todo:t1' })).toMatchObject({ folded: ['a'], zoom: 'step:todo:t1' })
})

test('a snapshot restored with the old cut gets those labels made again, siblings in spawn order; a label whose words changed since stays as it was fixed', () => {
  const base = M.emptyData(NOW)
  const row = (id: string, name: string, description: string, label: string, scope: string) => ({
    ...M.newAgent(id, 'agent', name, NOW, { description, parentId: M.MAIN, status: 'completed', origin: 'agent' }),
    label,
    scope,
  })
  const older = {
    ...base,
    agents: [
      ...base.agents,
      // the old cut of the words each still has: a hanging last word, and a sibling's " 2" after one
      row('r1', '', 'Recover goal and results on startup', 'Recover goal and', 'Recover goal and results on startup'),
      row('r2', '', 'Investigate the flaky refresh test suite', 'Investigate the', 'Investigate the flaky refresh test suite'),
      row('r3', '', 'Investigate the flaky refresh test suite', 'Investigate the 2', 'Investigate the flaky refresh test suite'),
      // fixed from words it no longer has: it stays
      row('r4', '', 'Something else entirely', 'Recover goal and', 'Recover goal and results on startup'),
      // the same under either cut
      row('r5', 'scout', 'Find the token bug', 'scout', 'Find the token bug'),
    ],
  }
  const healed = M.healData(JSON.parse(JSON.stringify(older)) as DeckData, NOW)
  const labels = (data: DeckData) => ['r1', 'r2', 'r3', 'r4', 'r5'].map(id => M.labelOf(agentIn(data, id)))
  expect(labels(healed)).toEqual(['Recover goal', 'Investigate the flaky', 'Investigate the flaky 2', 'Recover goal and', 'scout'])
  expect([M.scopeOf(agentIn(healed, 'r1')), M.scopeOf(agentIn(healed, 'r4'))]).toEqual(['Recover goal and results on startup', 'Recover goal and results on startup'])
  // made again once, a label stays: the next restore changes nothing
  expect(labels(M.healData(JSON.parse(JSON.stringify(healed)) as DeckData, NOW))).toEqual(labels(healed))
})

// The redraw policy.

test('events draw only when the screen would change: a notice that asks nothing and a stop of an unknown loop draw nothing; a checklist change does', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  const redraws = { count: 0 }
  world(on, clock, saved, { redraws })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.prompt.submit(typed('Fix the token refresh'))
  await $.agent.spawn(spawnOf({ toolUseId: 'toolu_fixer', description: 'Fix the bug', name: 'fixer' }))
  await clock.advance(3000)

  redraws.count = 0
  await $.classic.Notification({ message: 'Signed in', notification_type: 'auth_success' })
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-unknown', agent_transcript_path: '', agent_type: 'general-purpose' })
  expect(redraws.count).toBe(0)

  await $.tool.call(inLoop('agent-fixer', { tool: 'TodoWrite' as const, todos: [todo('Fix the bug', 'in_progress', 'Fixing the bug')] }))
  expect(redraws.count > 0).toBe(true)

  // the screen key moves with what the tab shows, not with time while nothing runs
  const data = lastOf(saved)
  const git = repoOf([])
  agentIn(data, 'agent-fixer').status = 'completed'
  expect(M.deckKeyOf(data, git, NOW)).toBe(M.deckKeyOf(data, git, NOW + 3_600_000))
  const before = M.deckKeyOf(data, git, NOW)
  M.noteTodo(data, agentIn(data, 'agent-fixer'), 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: [todo('Fix the bug', 'completed')] }, NOW)
  expect(M.deckKeyOf(data, git, NOW)).not.toBe(before)
})

// Ending rows.

test('rows end the moment the engine says: SubagentStop (its last message the result when none was handed back) and TeammateIdle', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  world(on, clock, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.agent.spawn(spawnOf({ toolUseId: 'toolu_scout', description: 'Look around', name: 'scout' }))
  await $.agent.spawn({ ...spawnOf({ toolUseId: 'toolu_mate', description: 'Pair on it', name: 'mate' }), isTeammate: true as const })
  await $.agent.spawn(spawnOf({ toolUseId: 'toolu_writer', description: 'Write it', name: 'writer' }))
  await $.tool.call(untyped({ tool: 'SubagentHandback', message: 'Wrote the README section.', agentId: 'agent-writer' }))
  await clock.advance(1000)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-scout', agent_transcript_path: '', agent_type: 'Explore', last_assistant_message: 'The bug is on line 12.' })
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-writer', agent_transcript_path: '', agent_type: 'general-purpose', last_assistant_message: 'Done.' })
  await $.classic.TeammateIdle({ teammate_name: 'mate', team_name: 'team' })
  await clock.advance(2000)

  const data = lastOf(saved)
  expect(['agent-scout', 'agent-mate', 'agent-writer'].map(id => [agentIn(data, id).status, agentIn(data, id).endedAt, agentIn(data, id).answer])).toEqual([
    ['completed', NOW + 1000, 'The bug is on line 12.'],
    ['idle', NOW + 1000, undefined],
    ['completed', NOW + 1000, 'Wrote the README section.'],
  ])
  // the turn's empty answer that follows changes nothing
  await $.turn.complete({ turnId: 'turn-writer', answer: '', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-writer' })
  await clock.advance(2000)
  expect(lastOf(saved).messages.filter(message => message.kind === 'result').map(message => [message.from, message.text])).toEqual([
    ['agent-writer', 'Wrote the README section.'],
    ['agent-scout', 'The bug is on line 12.'],
  ])
  // the idle teammate's next call is work again: running, its end let go
  await $.tool.call(inLoop('agent-mate', { tool: 'Read' as const, file_path: '/repo/src/a.ts' }))
  await clock.advance(2000)
  const mate = agentIn(lastOf(saved), 'agent-mate')
  expect([mate.status, mate.endedAt]).toEqual(['running', undefined])
})

// The plan approved, the team's own task events, and a commit by its sha, through the hooks.

test('an approved ExitPlanMode plan, the team`s TaskCreated and TaskCompleted, and a commit the shell reports by its sha all reach the data', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: DeckSnapshot[] = []
  const sha = 'e'.repeat(40)
  world(on, clock, saved, { commitSha: sha })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.prompt.submit(typed('Plan the v3 deck'))
  await $.turn.start({ text: 'Plan the v3 deck', turnId: 't1' })
  await $.tool.call({ tool: 'ExitPlanMode' })
  await clock.advance(2000)
  let data = lastOf(saved)
  expect(data.goals[0]?.plan?.steps).toEqual(['Phase A (data): the model and its tests', 'Phase B: the outline', 'Phase C: review'])
  expect(M.planOf(data).source).toBe('plan')

  await $.classic.TaskCreated({ task_id: '9', task_subject: 'Wire the outline', task_description: 'rows and folds' })
  await $.classic.TaskCompleted({ task_id: '9', task_subject: 'Wire the outline' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Wire the outline"', description: 'Commit the outline' })
  await clock.advance(2000)
  data = lastOf(saved)
  expect(data.board['9']).toMatchObject({ id: '9', subject: 'Wire the outline', description: 'rows and folds', status: 'done', doneAt: NOW + 2000 })
  // the board, once it has the goal's tasks, is the plan
  expect(M.planOf(data)).toMatchObject({ source: 'board', steps: [{ key: 'task:9', text: 'Wire the outline', status: 'done' }] })
  expect(data.commitsBy[sha]).toBe(M.MAIN)
})

test('a delivery`s envelope comes off with the sender it names; the send it echoes is found to the receiver, or to an agent of its name', () => {
  expect(M.unwrapMessage('<agent-message from="reviewer">\nIs it ready?\n</agent-message>')).toEqual({ text: 'Is it ready?', from: 'reviewer' })
  expect(M.unwrapMessage('<teammate-message teammate_id="lead" color="blue">\nGo on.\n</teammate-message>\n\nA note after it')).toEqual({ text: 'Go on.', from: 'lead' })
  expect(M.unwrapMessage('No envelope here')).toEqual({ text: 'No envelope here' })

  const data = M.emptyData(NOW)
  const old = M.newAgent('fixer-1', 'agent', 'fixer', NOW - 60_000, { status: 'completed', parentId: M.MAIN })
  const fixer = M.newAgent('fixer-2', 'agent', 'fixer', NOW - 30_000, { status: 'running', parentId: M.MAIN })
  data.agents.push(old, fixer)
  const sent = M.addMessage(data, { from: M.MAIN, to: 'fixer-1', kind: 'message', text: 'Is it ready?', at: NOW - 1_000 })
  // to the receiver's name (a send that resolved to the agent finished before)
  expect(M.echoOf(data, 'fixer-2', '<agent-message from="main">\nIs it ready?\n</agent-message>', NOW)).toBe(sent)
  // older than 20 seconds, or other words: no echo
  expect(M.echoOf(data, 'fixer-2', 'Is it ready?', NOW + 30_000)).toBeUndefined()
  expect(M.echoOf(data, 'fixer-2', 'Something else', NOW)).toBeUndefined()
  expect(M.echoOf(data, 'fixer-2', '<agent-message from="main"></agent-message>', NOW)).toBeUndefined()
})
