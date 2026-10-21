import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

/**
 * The debug dump: while `<mod>/.debug/` exists the deck writes what it
 * believes to `.debug/<sessionId>.json` (each session its own file), about
 * 2 s after the data changes; while it is absent the deck writes nothing at
 * all. The file system is stubbed here.
 */

const NOW = 1_700_000_100_000

type Disk = { isDebug: boolean; looks: string[]; writes: { path: string; text: string }[] }

/** Answers every engine call the deck makes, outside a repository, with `.debug/` there or not as `disk` says. */
function world(on: On, disk: Disk) {
  mock.store(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [] } }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', ($, e) => {
    disk.looks.push(e.path)
    return { value: disk.isDebug && /[\\/]\.debug$/.test(e.path) }
  })
  on('fs.write', ($, e) => {
    disk.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku', agentId: 'agent-x1' }))
  on('tool.call', () => ({ result: 'ok' }))
}

/** A Read made inside scout's loop, as the engine raises it there. */
function scoutReads(path: string): { tool: 'Read'; file_path: string } & { agentId: string } {
  return { tool: 'Read', file_path: path, agentId: 'agent-x1' }
}

/** You ask, and the Orchestrator starts scout on the hunt. */
async function work($: Engine) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'Fix the off-by-one in src/range.js', origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text: 'Fix the off-by-one in src/range.js', turnId: 't1' })
  await $.agent.spawn({
    tool_use_id: 'toolu_scout',
    prompt: 'Find the off-by-one in src/range.js',
    description: 'Find the bug',
    subagentType: 'Explore',
    name: 'scout',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-test',
    background: true,
    fork: false,
  })
}

test('with no .debug folder the deck never writes its state, however long it runs', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const disk: Disk = { isDebug: false, looks: [], writes: [] }
  world(on, disk)

  await work($)
  await clock.advance(12_000)

  // it looked (at the start and on its ticks), and found nothing to write to
  expect(disk.looks.length).toBeGreaterThan(1)
  expect(disk.looks.every(path => /[\\/]\.debug$/.test(path))).toBe(true)
  expect(disk.writes).toEqual([])
})

test('with the .debug folder the deck writes .debug/<sessionId>.json about 2 s after the data changes, and stops once the folder goes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const disk: Disk = { isDebug: true, looks: [], writes: [] }
  world(on, disk)

  await work($)
  expect(disk.writes).toEqual([])
  await clock.advance(2100)

  expect(disk.writes).toHaveLength(1)
  const [first] = disk.writes
  // the session's own file: two sessions loading the mod never overwrite each other's dump
  expect(first?.path).toMatch(/[\\/]\.debug[\\/]session-1\.json$/)
  const state = JSON.parse(first?.text ?? '{}')
  expect(state.meta).toMatchObject({ loadedAt: NOW, writes: 1 })
  expect(state.counts).toMatchObject({ agents: 3, shownAgents: 1, goals: 1 })
  expect(state.goal).toMatchObject({ headline: 'Fix the off-by-one in src/range.js' })
  expect(state.agents.find((agent: { id: string }) => agent.id === 'agent-x1')).toMatchObject({ label: 'scout', scope: 'Find the bug', origin: 'agent', status: 'running', parent: 'main', answer: null })
  expect(state.messages).toContainEqual({ from: 'main', to: 'agent-x1', route: 'Orchestrator → scout', kind: 'spawn', text: 'Find the off-by-one in src/range.js' })
  // the v2 tree, as every surface draws it: the Orchestrator, and scout at work under it (nothing folds while it works)
  expect(state.tree.map((row: { title: string; depth: number }) => `${row.depth}:${row.title}`)).toEqual(['0:Orchestrator', '1:scout'])
  expect(state.tree[1]).toMatchObject({ row: 'agent', id: 'agent-x1', kind: 'agent', status: 'running', fold: null, live: null, needs: 0 })
  expect(state.outline).toBeUndefined()
  expect(state.needs).toMatchObject({ kind: 'none' })
  expect(state.fold).toBeNull()

  // a change while a dump waits rides along with it: one write per 2 s at most
  await $.tool.call(scoutReads('/work/src/range.js'))
  await $.tool.call(scoutReads('/work/README.md'))
  await clock.advance(2100)
  expect(disk.writes).toHaveLength(2)
  const second = JSON.parse(disk.writes[1]?.text ?? '{}')
  expect(second.agents.find((agent: { id: string }) => agent.id === 'agent-x1').lastAction.text).toBe('Read /work/README.md')
  // its calls ended as they began: no call in flight on its row of the tree
  expect(second.tree[1]).toMatchObject({ title: 'scout', live: null })

  // the folder is gone: the next tick sees it, and no change writes again
  disk.isDebug = false
  await clock.advance(2600)
  await $.tool.call(scoutReads('/work/src/other.js'))
  await clock.advance(10_000)
  expect(disk.writes).toHaveLength(2)

  // back again: the tick that finds it dumps without waiting for a change
  disk.isDebug = true
  await clock.advance(5100)
  expect(disk.writes).toHaveLength(3)
})
