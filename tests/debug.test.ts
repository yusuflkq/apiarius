import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

/**
 * The debug dump: while `<home>/debug/` exists (Apiarius's home, never the
 * mod's folder) the deck writes what it believes to `debug/<sessionId>.json`
 * (each session its own file, made 0600 by web/home.js before its first
 * write), about 2 s after the data changes; while it is absent the deck
 * writes nothing at all. The file system is stubbed here.
 */
const HOME = '/home/me/.claude/apiarius'

const NOW = 1_700_000_100_000

type Disk = { isDebug: boolean; looks: string[]; writes: { path: string; text: string }[]; homeRuns: string[] }

/** A file call's path as the tests spell it: Claude Code resolves it the way the host does before a hook sees it, so on Windows `/home/me/…` arrives as `D:\home\me\…`. */
const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')

/** Answers every engine call the deck makes, outside a repository, with the home's `debug/` there or not as `disk` says. */
function world(on: On, disk: Disk) {
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [] } }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', ($, e) => {
    // web/home.js makes the dump's file private first; git finds no repository
    if (/[\\/]web[\\/]home\.js$/.test(e.argv[1] ?? '')) {
      disk.homeRuns.push(e.argv[2] ?? '')
      return { value: { exitCode: 0, stdout: '{"ok":true}\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', ($, e) => {
    disk.looks.push(norm(e.path))
    return { value: disk.isDebug && norm(e.path) === `${HOME}/debug` }
  })
  on('fs.write', ($, e) => {
    // the dump's writes alone: the registry's file in the home is another test's
    if (norm(e.path).startsWith(`${HOME}/debug/`)) disk.writes.push({ path: norm(e.path), text: e.text })
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

test('with no debug folder in the home the deck never writes its state, however long it runs', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const disk: Disk = { isDebug: false, looks: [], writes: [], homeRuns: [] }
  world(on, disk)

  await work($)
  await clock.advance(12_000)

  // it looked (at the start and on its ticks), and found nothing to write to
  expect(disk.looks.length).toBeGreaterThan(1)
  expect(disk.looks.every(path => path === `${HOME}/debug`)).toBe(true)
  expect(disk.writes.filter(one => one.path.includes('/debug/'))).toEqual([])
  expect(disk.homeRuns.some(run => run.includes('debug/'))).toBe(false)
})

test('with the home`s debug folder the deck writes debug/<sessionId>.json there about 2 s after the data changes, and stops once the folder goes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const disk: Disk = { isDebug: true, looks: [], writes: [], homeRuns: [] }
  world(on, disk)

  await work($)
  expect(disk.writes).toEqual([])
  await clock.advance(2100)

  expect(disk.writes).toHaveLength(1)
  const [first] = disk.writes
  // the session's own file in the home's debug folder: two sessions loading the mod never overwrite each other's dump
  expect(first?.path).toBe(`${HOME}/debug/session-1.json`)
  // made 0600 before its first write, once
  expect(disk.homeRuns.filter(run => run.includes('"debug/session-1.json"'))).toHaveLength(1)
  expect(JSON.parse(disk.homeRuns.find(run => run.includes('debug/'))!)).toMatchObject({ op: 'prepare', home: HOME, files: ['debug/session-1.json'], isOwnHome: true })
  const state = JSON.parse(first?.text ?? '{}')
  expect(state.meta).toMatchObject({ loadedAt: NOW, writes: 1 })
  expect(state.counts).toMatchObject({ agents: 3, shownAgents: 1, goals: 1 })
  // as v2 has it: your latest request in your words, what needs you (nothing), no plan Claude did not make
  expect(state.header).toMatchObject({ state: 'working', goal: { headline: 'Fix the off-by-one in src/range.js' } })
  expect([state.needs, state.plan]).toEqual([[], null])
  expect(state.view).toMatchObject({ page: '', v2: { tab: 'now', openFolds: [], chatFilter: '' }, focus: '', isDemo: false })
  // each loop as Claude Code gave it, nothing made up for it
  expect(state.agents.find((agent: { id: string }) => agent.id === 'agent-x1')).toMatchObject({ name: 'scout', description: 'Find the bug', type: 'Explore', origin: 'agent', status: 'running', parent: 'main', background: true, current: null, recent: [], answer: null })
  expect(state.chat).toContainEqual({ from: 'main', to: 'agent-x1', who: 'Orchestrator → scout', kind: 'spawn', text: 'Find the off-by-one in src/range.js' })
  // the v2 tree, as every surface draws it: the Orchestrator, and scout at work under it (nothing folds while it works)
  expect(state.tree.map((row: { title: string; depth: number }) => `${row.depth}:${row.title}`)).toEqual(['0:Orchestrator', '1:scout'])
  expect(state.tree[1]).toMatchObject({ row: 'agent', id: 'agent-x1', kind: 'agent', status: 'running', fold: null, live: null, needs: 0 })
  // nothing of the made-up plan, summary, needs line, labels or fold of earlier builds
  for (const gone of ['outline', 'goal', 'summary', 'fold', 'files', 'messages']) expect(state[gone]).toBeUndefined()

  // a change while a dump waits rides along with it: one write per 2 s at most
  await $.tool.call(scoutReads('/work/src/range.js'))
  await $.tool.call(scoutReads('/work/README.md'))
  await clock.advance(2100)
  expect(disk.writes).toHaveLength(2)
  const second = JSON.parse(disk.writes[1]?.text ?? '{}')
  expect(second.agents.find((agent: { id: string }) => agent.id === 'agent-x1').recent).toEqual(['Read /work/src/range.js', 'Read /work/README.md'])
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
