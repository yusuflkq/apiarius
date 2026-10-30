import type { On, ProcessSpawnChunk, ProcessSpawnRequest, ProcessSpawnResult } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit, type Commit, type FileRow, type GitState } from '../hooks/git'
import * as M from '../hooks/model'
import * as W from '../hooks/web'
import type { DeckAgent, DeckData, DeckWebSaved } from '../types'

/**
 * The web deck: what `.web/<sessionId>/state.json` holds (v1),
 * the patches written beside it once each, and `/apiarius web`: the server
 * started through `$.process.spawn` (stubbed here as a child the test
 * drives), its link answered, the Browser pane asked to open it, and the
 * page's commands read back off the child's stdout.
 */

const NOW = 1_700_000_100_000
const PORT = 4321
const PID = '4242'

// ---------------------------------------------------------------------------
// webStateOf: pure.

function agent(data: DeckData, id: string, name: string, extra: Partial<DeckAgent> = {}): DeckAgent {
  const made = M.newAgent(id, 'agent', name, NOW - 240_000, { type: 'general-purpose', parentId: M.MAIN, status: 'running', ...extra })
  data.agents.push(made)
  return made
}

function commit(n: number): Commit {
  const hash = `${String(n).padStart(2, '0')}${'c'.repeat(38)}`
  return { hash, short: hash.slice(0, 7), author: 'Sam', at: NOW - n * 60_000, subject: `Commit ${n}`, files: 1, added: n, removed: 0 }
}

function fileRow(path: string): FileRow {
  return { path, code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 2, removed: 1 }
}

/**
 * A session well under way: you asked for a fix; the Orchestrator runs
 * fixer (waiting on you for `npm test`), which runs helper; reviewer is done
 * with a long report; a teammate, a workflow's agent, a housekeeping loop and
 * an outside peer; 260 messages, past 150 tool calls, 350 edits.
 */
function richData(): DeckData {
  const data = M.emptyData(NOW - 600_000)
  const main = M.agentOf(data, M.MAIN)!
  Object.assign(main, { status: 'running', model: 'claude-opus-5-5', tokensIn: 1000, tokensOut: 200, cacheRead: 5000 })
  M.noteGoal(data, 'goal', { text: 'Fix the login bug in src/auth.ts', origin: 'composer', at: NOW - 500_000 })
  const fixer = agent(data, 'agent-fixer', 'fixer', { description: 'Fix the login bug', prompt: `Fix it. ${'x'.repeat(3000)}`, model: 'claude-haiku-4-5-20251001', tokensIn: 10, tokensOut: 20, cacheRead: 30, goal: data.goals[0]?.id })
  agent(data, 'agent-helper', 'helper', { parentId: fixer.id, type: 'Explore', description: 'Find the auth module' })
  agent(data, 'agent-reviewer', 'reviewer', { status: 'completed', endedAt: NOW - 60_000, answer: `Done: all good. ${'y'.repeat(5000)}` })
  agent(data, 'agent-mate', 'mate', { kind: 'teammate', origin: 'teammate' })
  agent(data, 'agent-flow', 'flow step', { origin: 'workflow' })
  agent(data, 'agent-compact', 'compact', { origin: 'engine', status: 'completed', endedAt: NOW - 30_000 })
  data.agents.push(M.newAgent('peer:other', 'peer', 'other', NOW - 100_000))
  // fixer waits on you for its call
  M.beginTool(data, fixer, M.activityOf('call-test', 'Bash', { command: 'npm test', description: 'Run the unit tests' }, '/repo', NOW - 20_000))
  M.noteNeeds(data, { kind: 'permission_prompt', text: 'Claude needs your permission to use Bash', at: NOW - 10_000, agent: fixer.id })
  // tool calls: fourteen kept per agent, twelve agents
  for (let i = 0; i < 12; i++) {
    const one = i < 2 ? (M.agentOf(data, i === 0 ? M.MAIN : 'agent-helper') as DeckAgent) : agent(data, `agent-busy-${i}`, `busy ${i}`)
    for (let j = 0; j < 14; j++) {
      const at = NOW - 400_000 + i * 1000 + j * 10
      M.beginTool(data, one, M.activityOf(`t-${i}-${j}`, 'Read', { file_path: `/repo/src/f${j}.ts` }, '/repo', at))
      M.endTool(one, `t-${i}-${j}`, j % 5 !== 0, at + 5)
    }
  }
  for (let i = 0; i < 260; i++) M.addMessage(data, { from: i === 0 ? M.YOU : M.MAIN, to: i === 0 ? M.MAIN : fixer.id, kind: i === 0 ? 'prompt' : 'message', text: i === 250 ? 'z'.repeat(1000) : `message ${i}`, at: NOW - 300_000 + i })
  for (let i = 0; i < 350; i++) {
    data.edits.push({ id: i === 349 ? 'toolu_last:0' : `toolu_${i}`, agent: fixer.id, tool: 'Edit', path: `src/f${i % 7}.ts`, abs: `/repo/src/f${i % 7}.ts`, at: NOW - 200_000 + i, added: 1, removed: 1, patch: '@@ -1,1 +1,1 @@\n-a\n+b', isNew: false })
  }
  M.noteFile(data, { agent: fixer.id, path: 'src/auth.ts', abs: '/repo/src/auth.ts', at: NOW - 50_000, added: 3, removed: 1, isNew: false })
  data.commitsBy[commit(1).hash] = fixer.id
  return data
}

const GIT: GitState = {
  ...emptyGit(),
  isRepo: true,
  root: '/repo',
  branch: 'main',
  head: commit(1).hash,
  ahead: 2,
  behind: 1,
  checkedAt: NOW,
  files: [fileRow('src/auth.ts'), fileRow('notes.txt')],
  commits: Array.from({ length: 30 }, (_, i) => commit(i + 1)),
}

const USAGE = { startedAt: NOW - 600_000, contextPercent: 38, costUsd: 6.42, limits: [] }

const STATE_KEYS = ['v', 'now', 'session', 'repo', 'goal', 'needs', 'summary', 'plan', 'agents', 'messages', 'activity', 'files', 'edits', 'changes', 'commits', 'pending', 'acks']
const AGENT_KEYS = ['id', 'label', 'scope', 'type', 'model', 'kind', 'parent', 'status', 'needsYou', 'startedAt', 'endedAt', 'now', 'task', 'result', 'checklist', 'lastAction', 'tools', 'errors', 'tokens', 'added', 'removed', 'files', 'avatar']
const SUMMARY_KEYS = ['step', 'stepText', 'running', 'waiting', 'done', 'failed', 'files', 'filesInRepo', 'added', 'removed', 'minutes', 'tokens', 'costUsd', 'contextPercent']

test('webStateOf: the v1 schema, field by field, as plain JSON', () => {
  const data = richData()
  const state = W.webStateOf(data, M.defaultView(), GIT, USAGE, NOW, 'session-1', '/repo')
  expect(Object.keys(state)).toEqual(STATE_KEYS)
  expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  expect(state).toMatchObject({ v: 1, now: NOW, session: { id: 'session-1', cwd: '/repo', startedAt: NOW - 600_000, model: 'opus-5.5' } })
  expect(state.repo).toEqual({ name: 'repo', root: '/repo', branch: 'main', ahead: 2, behind: 1, head: commit(1).hash })
  expect(state.goal).toEqual({ headline: 'Fix the login bug in src/auth.ts', text: 'Fix the login bug in src/auth.ts', at: NOW - 500_000, followUps: [] })
  expect(state.needs).toEqual({ tone: 'attention', kind: 'blocked', text: 'fixer needs your OK to run `npm test`', agentId: 'agent-fixer' })
  expect(Object.keys(state.summary)).toEqual(SUMMARY_KEYS)
  expect(state.summary).toMatchObject({ files: 2, costUsd: 6.42, contextPercent: 38, waiting: 1 })
  const tokens = data.agents.reduce((sum, one) => sum + one.tokensIn + one.tokensOut + one.cacheRead, 0)
  expect(state.summary.tokens).toBe(tokens)
  expect(state.plan.source).toBe('implicit')

  // every agent but you, each with the state's fields
  expect(state.agents.map(one => one.id)).not.toContain(M.YOU)
  for (const one of state.agents) expect(Object.keys(one)).toEqual(AGENT_KEYS)
  const byId = new Map(state.agents.map(one => [one.id, one]))
  expect(byId.get(M.MAIN)).toMatchObject({ label: 'Orchestrator', kind: 'orchestrator', parent: null, type: 'main loop', model: 'opus-5.5', task: 'Fix the login bug in src/auth.ts', result: '' })
  expect(byId.get('agent-fixer')).toMatchObject({
    label: 'fixer',
    kind: 'agent',
    parent: M.MAIN,
    status: 'waiting',
    needsYou: 'needs your OK to run `npm test`',
    now: 'Needs your OK to run `npm test`',
    model: 'haiku-4.5',
    lastAction: { tool: 'Bash', text: 'Run the unit tests', isLive: true },
    tokens: { in: 10, out: 20, cacheRead: 30 },
    endedAt: null,
  })
  expect(byId.get('agent-helper')).toMatchObject({ parent: 'agent-fixer', kind: 'agent', status: 'running', needsYou: null })
  expect(byId.get('agent-reviewer')).toMatchObject({ status: 'done', now: 'all good.', endedAt: NOW - 60_000 })
  // workflow and housekeeping loops are background; teammates and peers keep their kind
  expect(byId.get('agent-flow')?.kind).toBe('background')
  expect(byId.get('agent-compact')?.kind).toBe('background')
  expect(byId.get('agent-mate')?.kind).toBe('teammate')
  expect(byId.get('peer:other')).toMatchObject({ kind: 'peer', parent: null, status: 'idle' })

  // the newest of each list, oldest first; git's changes with who edited them; commits newest first, with their agent
  expect(state.messages[0]?.text).toBe('message 60')
  expect(state.messages[state.messages.length - 1]?.text).toBe('message 259')
  expect(state.activity.map(one => one.at)).toEqual([...state.activity.map(one => one.at)].sort((a, b) => a - b))
  expect(state.activity[0]).toEqual({ at: expect.any(Number), agent: expect.any(String), tool: 'Read', target: expect.any(String), ok: expect.any(Boolean), ms: 5 })
  expect(state.changes).toEqual([
    { path: 'src/auth.ts', code: 'M', added: 2, removed: 1, editors: ['agent-fixer'] },
    { path: 'notes.txt', code: 'M', added: 2, removed: 1, editors: [] },
  ])
  expect(state.commits[0]).toEqual({ hash: commit(1).hash, short: commit(1).short, subject: 'Commit 1', author: 'Sam', at: NOW - 60_000, added: 1, removed: 0, files: 1, agent: 'agent-fixer' })
  expect(state.commits[1]?.agent).toBeNull()
  expect(state.files[0]).toEqual({ path: 'src/auth.ts', editors: ['agent-fixer'], live: true, isShared: false, added: 3, removed: 1, lastAt: NOW - 50_000 })

  // outside a repository: no repo, no changes, no commits
  const bare = W.webStateOf(data, M.defaultView(), { ...emptyGit(), isRepo: false, checkedAt: NOW }, null, NOW, 'session-1', '/work')
  expect(bare).toMatchObject({ repo: null, changes: [], commits: [], summary: { costUsd: null, contextPercent: null } })
})

test('webStateOf: the caps, 200 messages of 600 characters, 150 tool calls, 300 edits, 20 commits, tasks of 2000 and results of 4000', () => {
  const state = W.webStateOf(richData(), M.defaultView(), GIT, USAGE, NOW, 'session-1', '/repo')
  expect(state.messages).toHaveLength(W.WEB_CAPS.messages)
  expect(Math.max(...state.messages.map(one => Array.from(one.text).length))).toBe(W.WEB_CAPS.messageChars)
  expect(state.activity).toHaveLength(W.WEB_CAPS.activity)
  expect(state.edits).toHaveLength(W.WEB_CAPS.edits)
  expect(state.edits[0]?.id).toBe('toolu_50')
  expect(state.commits).toHaveLength(W.WEB_CAPS.commits)
  const fixer = state.agents.find(one => one.id === 'agent-fixer')
  const reviewer = state.agents.find(one => one.id === 'agent-reviewer')
  expect(Array.from(fixer?.task ?? '').length).toBe(W.WEB_CAPS.task)
  expect(Array.from(reviewer?.result ?? '').length).toBe(W.WEB_CAPS.result)
  // the user is 'you' in messages
  const data = richData()
  data.messages.splice(0, data.messages.length)
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: 'Fix it', at: NOW })
  expect(W.webStateOf(data, M.defaultView(), GIT, USAGE, NOW, 's', '/repo').messages).toEqual([{ id: expect.any(String), at: NOW, from: 'you', to: 'main', kind: 'prompt', text: 'Fix it' }])
})

test('webStateOf on a live run`s shape: the step only while one is in progress, the Orchestrator`s plan as its checklist and its answer as its report, lines that never show a stale call, board calls in words, tasks and reports whole', () => {
  const data = M.emptyData(NOW - 600_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  M.noteGoal(data, 'goal', { text: 'Make a small change', origin: 'composer', at: NOW - 500_000 })
  const subjects = ['Map the repository', 'Add jitter to backoffDelays', 'Summarise the changes']
  subjects.forEach((subject, i) => M.noteBoard(data, main, 'TaskCreate', { subject }, { task: { id: String(i + 1), subject } }, NOW - 400_000))
  const at = (state: W.WebState, id: string) => state.agents.find(one => one.id === id)
  const stateOf = () => W.webStateOf(data, M.defaultView(), GIT, USAGE, NOW, 's', '/repo')

  // no step in progress: no "0 of 3" (the page would say "Step 0 of 3")
  let state = stateOf()
  expect(state.summary).toMatchObject({ step: null, stepText: null })
  // the Orchestrator wrote the plan: its steps are its checklist
  expect(at(state, M.MAIN)?.checklist).toEqual({ items: subjects.map(text => ({ text, status: 'pending' })), done: 0, total: 3 })
  M.noteBoard(data, main, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true, taskId: '1', updatedFields: ['status'] }, NOW - 300_000)
  M.noteBoard(data, main, 'TaskUpdate', { taskId: '2', status: 'in_progress' }, { success: true, taskId: '2', updatedFields: ['status'] }, NOW - 300_000)
  state = stateOf()
  expect(state.summary).toMatchObject({ step: '2 of 3', stepText: 'Add jitter to backoffDelays' })
  expect(at(state, M.MAIN)?.checklist).toMatchObject({ done: 1, total: 3, items: [{ status: 'done' }, { status: 'active' }, { status: 'pending' }] })
  M.noteBoard(data, main, 'TaskUpdate', { taskId: '2', status: 'completed' }, { success: true, taskId: '2', updatedFields: ['status'] }, NOW - 200_000)
  M.noteBoard(data, main, 'TaskUpdate', { taskId: '3', status: 'completed' }, { success: true, taskId: '3', updatedFields: ['status'] }, NOW - 200_000)
  // all done: still no step "3 of 3"; the page says "3 of 3 done"
  expect(stateOf().summary).toMatchObject({ step: null, stepText: null })

  // the Orchestrator's line: its call in flight, the agents it waits on, else "Working"; an earlier call is never "now"
  M.beginTool(data, main, M.activityOf('t-spawn', 'Agent', { description: 'Add jitter to backoffDelays' }, '/repo', NOW - 190_000))
  M.endTool(main, 't-spawn', true, NOW - 189_000)
  expect(at(stateOf(), M.MAIN)?.now).toBe('Working')
  const jitter = M.noteSpawn(data, {
    toolUseId: 'toolu_jitter',
    agentId: 'agent-jitter',
    parentId: M.MAIN,
    description: 'Add jitter to backoffDelays',
    prompt: `Add jitter. ${'p'.repeat(1500)}`,
    type: 'general-purpose',
    isTeammate: false,
    at: NOW - 180_000,
  }).agent
  jitter.status = 'running'
  expect(at(stateOf(), M.MAIN)?.now).toBe('Waiting on 1 agent')
  M.beginTool(data, main, M.activityOf('t-read', 'Read', { file_path: '/repo/src/a.ts' }, '/repo', NOW - 1000))
  expect(at(stateOf(), M.MAIN)?.now).toBe('Read src/a.ts')
  M.endTool(main, 't-read', true, NOW - 900)
  jitter.status = 'completed'
  jitter.endedAt = NOW - 500
  // a long task and report stay whole up to the state's caps (not cut at 700 and 1400 characters)
  M.noteResult(data, jitter, `Added the jitter option. ${'r'.repeat(2500)}`, NOW - 500)
  state = stateOf()
  expect(at(state, 'agent-jitter')?.task.length).toBe(1512)
  expect(at(state, 'agent-jitter')?.result.length).toBe(2525)
  // between turns: its latest answer to you is its report and its line
  main.status = 'idle'
  expect(at(stateOf(), M.MAIN)).toMatchObject({ now: 'Idle', result: '' })
  M.noteMainAnswer(main, 'Summary: all three agents finished.\n\n- jitter: src/retry/backoff-delays.js')
  expect(at(stateOf(), M.MAIN)).toMatchObject({ now: 'all three agents finished.', result: 'Summary: all three agents finished.\n\n- jitter: src/retry/backoff-delays.js' })

  // board calls read as their tasks, not ids; a tool search as the tools it loads
  const board = data.board
  expect(M.targetOf('TaskUpdate', { taskId: '2', status: 'completed' }, '/repo', board)).toBe('Add jitter to backoffDelays → done')
  expect(M.targetOf('TaskUpdate', { taskId: '3', status: 'in_progress' }, '/repo', board)).toBe('Summarise the changes → in progress')
  expect(M.targetOf('TaskUpdate', { taskId: '9', owner: 'fixer' }, '/repo', board)).toBe('task 9')
  expect(M.targetOf('TaskCreate', { subject: 'Test the jitter option', description: 'one test' }, '/repo', board)).toBe('Test the jitter option')
  expect(M.targetOf('TaskList', {}, '/repo', board)).toBe('the task list')
  expect(M.targetOf('ToolSearch', { query: 'select:TaskCreate,TaskUpdate', max_results: 2 }, '/repo')).toBe('TaskCreate, TaskUpdate')
  expect(M.targetOf('ToolSearch', { query: 'slack send' }, '/repo')).toBe('slack send')
})

test('a message or report cut for the page never leaves a lone backtick, which its markdown would show', () => {
  // the live run's helper report, cut at 600 inside "`general-purpose`"
  expect(W.cutMarkdown('Done. A `general-purpose` agent', 12)).toBe('Done. A…')
  expect(W.cutMarkdown('Use `a` and `b` here', 10)).toBe('Use `a` a…')
  // a fenced block cut open is the page's to close
  expect(W.cutMarkdown('```js\nconst a = 1\nconst b = 2\n```', 15)).toBe('```js\nconst a …')
  expect(W.cutMarkdown('short `code`', 600)).toBe('short `code`')
  const data = M.emptyData(NOW - 60_000)
  const report = `Source change (done): ${'x'.repeat(540)} Test helper (running): A \`general-purpose\` agent is adding one test.`
  M.addMessage(data, { from: 'agent-x', to: M.MAIN, kind: 'result', text: report, at: NOW })
  const [message] = W.webStateOf(data, M.defaultView(), GIT, USAGE, NOW, 's', '/repo').messages
  expect(message?.text.endsWith('A…')).toBe(true)
  expect((message?.text.match(/`/g) ?? []).length % 2).toBe(0)
})

test('avatars are 0 to 9 and stable per agent id; ids, models and lines read as the page takes them', () => {
  const first = W.webStateOf(richData(), M.defaultView(), GIT, USAGE, NOW, 's', '/repo')
  const again = W.webStateOf(richData(), M.defaultView(), GIT, USAGE, NOW + 60_000, 's', '/repo')
  for (const one of first.agents) {
    expect(Number.isInteger(one.avatar) && one.avatar >= 0 && one.avatar <= 9).toBe(true)
    expect(one.avatar).toBe(W.avatarOf(one.id))
    expect(again.agents.find(other => other.id === one.id)?.avatar).toBe(one.avatar)
  }
  expect(new Set(first.agents.map(one => one.avatar)).size).toBeGreaterThan(3)
  // edit ids the server's /patch/<id> takes: [A-Za-z0-9_-] only, never two alike
  expect(W.webIdOf('toolu_01Ab')).toBe('toolu_01Ab')
  expect(W.webIdOf('toolu_1:0')).toBe('toolu_1-3a0')
  expect(W.webIdOf('a-b')).not.toBe(W.webIdOf('a_b'))
  for (const one of first.edits) expect(one.id).toMatch(/^[A-Za-z0-9_-]+$/)
  expect(first.edits[first.edits.length - 1]?.id).toBe('toolu_last-3a0')
  expect(['claude-opus-5-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5[1m]', 'us.anthropic.claude-opus-4-1-20250805-v1:0', 'claude-3-5-sonnet-20241022', 'claude-test', '', undefined].map(W.shortModel)).toEqual([
    'opus-5.5',
    'haiku-4.5',
    'sonnet-4.5',
    'opus-4.1',
    'sonnet-3.5',
    'test',
    '',
    '',
  ])
  expect(W.webUrlOf(PORT, 'tok')).toBe(`http://127.0.0.1:${PORT}/?t=tok`)
  expect(W.webDirOf('C:\\mod\\', 'a/b')).toBe('C:\\mod/.web/a_b')
  expect(W.serverArgvOf('/mod/web/server.js', '/mod/.web/s', PID, 0)).toEqual(['node', '/mod/web/server.js', '--dir', '/mod/.web/s', '--parent', PID])
  expect(W.serverArgvOf('/mod/web/server.js', '/mod/.web/s', '', PORT)).toEqual(['node', '/mod/web/server.js', '--dir', '/mod/.web/s', '--port', String(PORT)])
})

test("the server's lines: split chunks are buffered into whole lines, and only valid commands to agents the deck holds are routed", () => {
  // a line across three chunks, then two lines in one, a \r before a newline, a blank line
  let cut = W.splitLines('', '{"cmd":"chat","agentId":"age')
  expect(cut).toEqual({ lines: [], rest: '{"cmd":"chat","agentId":"age' })
  cut = W.splitLines(cut.rest, 'nt-fixer","text":"hel')
  expect(cut.lines).toEqual([])
  cut = W.splitLines(cut.rest, 'lo"}\r\n\n{"cmd":"ping"}\n{"rea')
  expect(cut).toEqual({ lines: ['{"cmd":"chat","agentId":"agent-fixer","text":"hello"}', '{"cmd":"ping"}'], rest: '{"rea' })
  // a line that never ends is let go before it grows past any command
  expect(W.splitLines('', 'x'.repeat(70_000)).rest).toBe('')

  expect(W.parseLine('{"ready":4321}')).toEqual({ kind: 'ready', port: 4321 })
  for (const bad of ['', 'not json', '[1]', '{"ready":0}', '{"ready":"4321"}', '{"ready":70000}', '{"cmd":7}', 'null']) expect(W.parseLine(bad)).toBeNull()

  const data = richData()
  const route = (line: string) => {
    const said = W.parseLine(line)
    return said?.kind === 'cmd' ? W.routeOf(said.cmd, data) : null
  }
  expect(route('{"cmd":"chat","agentId":"agent-fixer","text":"  hello  "}')).toEqual({ kind: 'chat', agentId: 'agent-fixer', text: 'hello' })
  expect(route('{"cmd":"chat","agentId":"main","text":"go on"}')).toEqual({ kind: 'chat', agentId: 'main', text: 'go on' })
  expect(route('{"cmd":"review","text":"Review the diff"}')).toEqual({ kind: 'review', text: 'Review the diff' })
  expect(route('{"cmd":"ping"}')).toEqual({ kind: 'ping' })
  // an agent the deck does not hold, you, a peer, no text, too much text, a command it does not know
  for (const bad of [
    '{"cmd":"chat","agentId":"agent-nobody","text":"hi"}',
    '{"cmd":"chat","agentId":"you","text":"hi"}',
    '{"cmd":"chat","agentId":"peer:other","text":"hi"}',
    '{"cmd":"chat","agentId":"agent-fixer","text":"   "}',
    '{"cmd":"chat","agentId":"agent-fixer"}',
    `{"cmd":"chat","agentId":"agent-fixer","text":"${'a'.repeat(4001)}"}`,
    `{"cmd":"review","text":"${'a'.repeat(4001)}"}`,
    '{"cmd":"delete","path":"/"}',
  ]) {
    expect(route(bad)).toBeNull()
  }
})

// ---------------------------------------------------------------------------
// Through the hooks: /apiarius web, the child, the files, the commands.

/** A child the test drives: what it prints, and when it ends. */
type Child = { request: ProcessSpawnRequest; print: (text: string) => void; end: () => void; isRead: boolean }

type World = {
  children: Child[]
  /** What each new child prints at once: the ready line on a port, or nothing. */
  ready: number[]
  /** Node is missing: a spawn rejects its first pull. */
  isMissing: boolean
  /** The Browser pane answers preview_start. */
  hasBrowser: boolean
  writes: { path: string; text: string }[]
  sent: { to: string; text: string }[]
  filled: string[]
  toasts: string[]
  opened: { server: string; tool: string; url: unknown }[]
  saved: DeckWebSaved[]
}

function newWorld(extra: Partial<World> = {}): World {
  return { children: [], ready: [PORT], isMissing: false, hasBrowser: true, writes: [], sent: [], filled: [], toasts: [], opened: [], saved: [], ...extra }
}

const EDIT_RESULT = {
  filePath: '/work/src/app.ts',
  oldString: 'const b = 2',
  newString: 'const b = 3',
  originalFile: 'const a = 1\nconst b = 2\n',
  structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' const a = 1', '-const b = 2', '+const b = 3'] }],
  userModified: false,
  replaceAll: false,
}

/** Answers every engine call the deck makes, outside a repository; `saved` is what `$.state` kept of the web deck. */
function world(on: On, w: World, saved?: DeckWebSaved) {
  mock.store(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } } }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  // node prints its parent (the session's process); git finds no repository
  on('process.run', ($, e) =>
    e.argv[0] === 'node'
      ? { value: { exitCode: 0, stdout: `${PID}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } },
  )
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: NOW, isLink: false } }))
  on('fs.write', ($, e) => {
    w.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.send', ($, e) => {
    w.sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('prompt.fill', ($, e) => {
    w.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku', agentId: 'agent-x1' }))
  on('tool.call', ($, e) => (e.tool === 'Edit' ? { result: EDIT_RESULT } : e.tool.startsWith('mcp__') ? { deny: 'no such tool' } : { result: 'ok' }))
  on('mcp.call', ($, e) => {
    w.opened.push({ server: e.server, tool: e.tool, url: e.args.url })
    return { value: { content: [{ type: 'text', text: w.hasBrowser ? 'Browser pane opened.' : 'no Browser pane' }], isError: !w.hasBrowser } }
  })
  on('state.set', { plugin: 'apiarius', key: 'web' }, ($, e) => {
    w.saved.push(JSON.parse(JSON.stringify(e.value)) as DeckWebSaved)
    return { value: { isSet: true as const, version: w.saved.length } }
  })
  if (saved) on('state.get', { plugin: 'apiarius', key: 'web' }, () => ({ value: { value: saved, version: 1 } }))
  on('process.spawn', async function* ($, e, next): AsyncGenerator<ProcessSpawnChunk, { value: ProcessSpawnResult } | { deny: string }> {
    // no node: the start fails, as the engine's ENOENT does
    if (w.isMissing) return { deny: "failed to start: ENOENT: Command 'node' not found or is in an unsafe location" }
    const queue: string[] = []
    let wake: (() => void) | undefined
    let isEnded = false
    const child: Child = {
      request: JSON.parse(JSON.stringify(e)) as ProcessSpawnRequest,
      print: text => {
        queue.push(text)
        wake?.()
      },
      end: () => {
        isEnded = true
        wake?.()
      },
      isRead: true,
    }
    w.children.push(child)
    next.signal.addEventListener('abort', () => child.end())
    const port = w.ready.shift()
    if (port !== undefined) queue.push(`{"ready":${port}}\n`)
    try {
      for (;;) {
        const text = queue.shift()
        if (text !== undefined) {
          yield { stream: 'stdout', text }
          continue
        }
        if (isEnded) return { value: { code: 0, signal: null } }
        await new Promise<void>(resolve => {
          wake = resolve
        })
        wake = undefined
      }
    } finally {
      child.isRead = false
    }
  })
}

/** /apiarius as typed at the prompt, with what the engine stamps on it. */
function deck(args: string) {
  return { command: 'apiarius', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 100 } }
}

/** The session starts, you ask, and the Orchestrator starts scout (`agent-x1`). */
async function work($: Engine) {
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
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

function statesOf(w: World): { path: string; state: W.WebState }[] {
  return w.writes.filter(one => /[\\/]\.web[\\/]session-1[\\/]state\.json$/.test(one.path)).map(one => ({ path: one.path, state: JSON.parse(one.text) as W.WebState }))
}

function patchesOf(w: World): string[] {
  return w.writes.filter(one => /[\\/]patches[\\/]/.test(one.path)).map(one => one.path.replace(/^.*[\\/]patches[\\/]/, ''))
}

/** The page's link in an answer, and its token. */
function linkOf(text: string | undefined): { url: string; token: string } {
  const found = /\[Open the Apiarius deck\]\((http:\/\/127\.0\.0\.1:(\d+)\/\?t=([^)]+))\) in the Browser pane/.exec(text ?? '')
  return { url: found?.[1] ?? '', token: decodeURIComponent(found?.[3] ?? '') }
}

test('/apiarius web starts the server once (node, web/server.js, its folder, the session pid, the token in its env), answers its link and opens it in the Browser pane', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  // nothing is written for the web before /apiarius web
  await clock.advance(3000)
  expect(statesOf(w)).toEqual([])

  const answer = await $.command.run(deck('web'))
  const { url, token } = linkOf(answer.text)
  expect(answer.text).toBe(`[Open the Apiarius deck](${url}) in the Browser pane`)
  expect(url).toBe(`http://127.0.0.1:${PORT}/?t=${encodeURIComponent(token)}`)
  expect(token).toMatch(/^[0-9a-f-]{36}$/)
  expect(answer.context?.some(line => line.includes(url))).toBe(true)

  expect(w.children).toHaveLength(1)
  const { argv, env } = w.children[0]!.request
  expect(argv[0]).toBe('node')
  expect(argv[1]).toMatch(/[\\/]web[\\/]server\.js$/)
  expect(argv.slice(2, 4)).toEqual(['--dir', expect.stringMatching(/[\\/]\.web[\\/]session-1$/)])
  expect(argv.slice(4)).toEqual(['--parent', PID])
  expect(env).toEqual({ APIARIUS_TOKEN: token })
  // the state was there before the server started, and $.state keeps the switch, token, port and folder
  expect(statesOf(w).length).toBeGreaterThan(0)
  expect(w.saved[w.saved.length - 1]).toEqual({ isOn: true, token, port: PORT, dir: argv[3] })
  await clock.settle()
  expect(w.opened[0]).toEqual({ server: 'Claude_Browser', tool: 'preview_start', url })

  // again: the same link, no second server
  const again = await $.command.run(deck('web'))
  expect(linkOf(again.text).url).toBe(url)
  expect(w.children).toHaveLength(1)
  expect(w.children[0]?.isRead).toBe(true)
})

test('while on, state.json follows the data at most every 300 ms, and each edit`s patch is written once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  await $.command.run(deck('web'))
  await clock.advance(400)
  const before = statesOf(w).length

  // an edit: within 300 ms its patch, then the state naming it
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/app.ts', old_string: 'const b = 2', new_string: 'const b = 3', agentId: 'agent-x1' } as never)
  expect(statesOf(w).length).toBe(before)
  await clock.advance(350)
  const states = statesOf(w)
  expect(states.length).toBe(before + 1)
  const last = states[states.length - 1]!.state
  expect(last.edits).toHaveLength(1)
  const id = last.edits[0]!.id
  expect(patchesOf(w)).toEqual([`${id}.diff`])
  const patch = w.writes.find(one => one.path.endsWith(`${id}.diff`))?.text
  expect(patch).toBe('@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3\n')
  expect(last.agents.find(one => one.id === 'agent-x1')).toMatchObject({ label: 'scout', added: 1, removed: 1, status: 'running' })

  // three more calls in 300 ms: one write; the patch is not written again
  for (const path of ['/work/a.md', '/work/b.md', '/work/c.md']) await $.tool.call({ tool: 'Read', file_path: path, agentId: 'agent-x1' } as never)
  await clock.advance(350)
  expect(statesOf(w).length).toBe(before + 2)
  // a second edit: its own patch alone
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/app.ts', old_string: 'const b = 2', new_string: 'const b = 3', agentId: 'agent-x1' } as never)
  await clock.advance(350)
  const ids = statesOf(w).pop()!.state.edits.map(one => one.id)
  expect(ids).toHaveLength(2)
  expect(patchesOf(w)).toEqual(ids.map(one => `${one}.diff`))

  // nothing new: the 2.5 s ticks write nothing more
  const settled = statesOf(w).length
  await clock.advance(6000)
  expect(statesOf(w).length).toBe(settled)
})

/** The agent files written, by name, each write's text in order. */
function agentFilesOf(w: World): Map<string, string[]> {
  const files = new Map<string, string[]>()
  for (const one of w.writes) {
    const name = /[\\/]agents[\\/]([^\\/]+)\.json$/.exec(one.path)?.[1]
    if (name) files.set(name, [...(files.get(name) ?? []), one.text])
  }
  return files
}

test('state.json carries the v2 view model under `v2` beside v1, and each agent`s file (agents/<id>.json) is written when it changed, only then', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  await $.command.run(deck('web'))
  await clock.advance(400)
  const first = statesOf(w).pop()!.state as W.WebState & { v2: W.WebStateV2 }
  // v1 as it was, its keys first; v2 the same session as every surface draws it
  expect(Object.keys(first).slice(0, 2)).toEqual(['v', 'now'])
  expect(first.agents.map(one => one.id)).toContain('agent-x1')
  expect(first.v2).toMatchObject({ v: 2, session: { id: 'session-1', cwd: '/work' }, header: { state: 'working', goal: { text: 'Fix the off-by-one in src/range.js' } } })
  expect(first.v2.agents.map(row => (row.row === 'agent' ? `${row.depth}:${row.title}:${row.status}` : row.text))).toEqual(['0:Orchestrator:running', '1:scout:running'])
  expect(first.v2.chat.map(row => row.who)).toEqual(['You → Orchestrator', 'Orchestrator → scout'])
  let files = agentFilesOf(w)
  expect([...files.keys()].sort()).toEqual(['agent-2dx1', 'main'])
  expect(JSON.parse(files.get('agent-2dx1')![0]!)).toMatchObject({ v: 2, id: 'agent-x1', task: 'Find the off-by-one in src/range.js', activity: [], edits: [] })

  // scout edits: its file again (its call, its edit), the Orchestrator's not
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/app.ts', old_string: 'const b = 2', new_string: 'const b = 3', agentId: 'agent-x1' } as never)
  await clock.advance(350)
  files = agentFilesOf(w)
  expect([files.get('agent-2dx1')?.length, files.get('main')?.length]).toEqual([2, 1])
  const last = statesOf(w).pop()!.state as W.WebState & { v2: W.WebStateV2 }
  const scoutFile = JSON.parse(files.get('agent-2dx1')![1]!) as W.V2AgentFile
  expect(scoutFile.edits).toEqual([last.v2.changes.edits[0]!.id])
  expect(scoutFile.activity.map(one => [one.tool, one.ok])).toEqual([['Edit', true]])

  // nothing new: neither the state nor a file is written again
  const settled = [statesOf(w).length, w.writes.length]
  await clock.advance(6000)
  expect([statesOf(w).length, w.writes.length]).toEqual(settled)
})

test("the page's commands come back on the child's stdout: chat goes to session.send, review to the prompt box; split chunks are buffered, and a bad agent, bad JSON or an unknown command are ignored", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  await $.command.run(deck('web'))
  const child = w.children[0]!

  child.print('{"cmd":"chat","agentId":"agent-x1","te')
  await clock.settle()
  expect(w.sent).toEqual([])
  child.print('xt":"Look in src/range.js first"}\nnot json at all\n{"cmd":"chat","agentId":"agent-nobody","text":"hi"}\n')
  await clock.settle()
  child.print('{"cmd":"delete","path":"/"}\n{"cmd":"ping"}\n{"cmd":"review","text":"Review the diff of src/range.js"}\n')
  await clock.settle()

  expect(w.sent).toEqual([{ to: 'agent-x1', text: 'Look in src/range.js first' }])
  expect(w.filled).toEqual(['Review the diff of src/range.js'])
  expect(w.toasts).toContain('Sent to scout')
  // the loop reads on after the lines it ignored
  child.print('{"cmd":"chat","agentId":"agent-x1","text":"and the tests"}\n')
  await clock.settle()
  expect(w.sent.map(one => one.text)).toEqual(['Look in src/range.js first', 'and the tests'])
  expect(child.isRead).toBe(true)
})

test('without node the first read rejects: a toast, a text answer, and the deck stays native', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld({ isMissing: true })
  world(on, w)
  await work($)
  const answer = await $.command.run(deck('web'))
  expect(answer.text).toContain('Node.js was not found on PATH')
  expect(answer.text).not.toContain('http://')
  expect(w.toasts.some(text => text.includes('Node.js'))).toBe(true)
  expect(w.saved[w.saved.length - 1]?.isOn).toBe(false)
  // off: changes write nothing for the web
  const written = statesOf(w).length
  await $.tool.call({ tool: 'Read', file_path: '/work/a.md', agentId: 'agent-x1' } as never)
  await clock.advance(3000)
  expect(statesOf(w).length).toBe(written)
})

test('/apiarius web stop ends the child and the writes; a reload starts the server again with the same token on the same port', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld({ ready: [PORT] })
  const kept: DeckWebSaved = { isOn: true, token: 'token-kept', port: PORT, dir: '/mod/.web/session-1' }
  world(on, w, kept)
  // a reload: session.start finds the web deck on, and starts its server again
  await work($)
  await clock.settle()
  expect(w.children).toHaveLength(1)
  const { argv, env } = w.children[0]!.request
  expect(argv.slice(2)).toEqual(['--dir', '/mod/.web/session-1', '--parent', PID, '--port', String(PORT)])
  expect(env).toEqual({ APIARIUS_TOKEN: 'token-kept' })
  const answer = await $.command.run(deck('web'))
  expect(linkOf(answer.text)).toEqual({ url: `http://127.0.0.1:${PORT}/?t=token-kept`, token: 'token-kept' })
  expect(w.children).toHaveLength(1)
  expect(w.toasts.some(text => text.includes('another port'))).toBe(false)

  const stopped = await $.command.run(deck('web stop'))
  expect(stopped.text).toBe('Apiarius web stopped.')
  await clock.settle()
  expect(w.children[0]?.isRead).toBe(false)
  expect(w.saved[w.saved.length - 1]).toMatchObject({ isOn: false })
  const written = statesOf(w).length
  await $.tool.call({ tool: 'Read', file_path: '/work/a.md', agentId: 'agent-x1' } as never)
  await clock.advance(3000)
  expect(statesOf(w).length).toBe(written)
  expect((await $.command.run(deck('web stop'))).text).toBe('Apiarius web was not running.')
})

test('a restart that cannot take its old port again takes another and says so; one that never comes up on it tries a port the OS picks', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // the first child exits before its ready line, the second listens on 5555
  const w = newWorld({ ready: [] })
  world(on, w, { isOn: true, token: 'token-kept', port: PORT, dir: '/mod/.web/session-1' })
  await work($)
  await clock.settle()
  expect(w.children).toHaveLength(1)
  w.ready.push(5555)
  w.children[0]!.end()
  await clock.settle()
  expect(w.children).toHaveLength(2)
  expect(w.children[1]!.request.argv).not.toContain('--port')
  expect(w.toasts.some(text => text.includes('another port'))).toBe(true)
  const answer = await $.command.run(deck('web'))
  expect(linkOf(answer.text).url).toBe('http://127.0.0.1:5555/?t=token-kept')
})

test('the pane: with no Browser pane to open the web deck in, its link shows as markdown under the header', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld({ hasBrowser: false })
  world(on, w)
  await work($)
  await $.command.run(deck('web'))
  await clock.settle()
  expect(w.children).toHaveLength(1)
  // both spellings of the Browser pane's server, then the tool: none opened it
  expect(w.opened.map(one => one.server)).toEqual(['Claude_Browser', 'Claude Browser'])
  await $.command.run(deck(''))
  await clock.advance(500)
  const pane = { plugin: 'apiarius', surface: 'desktop' as const, component: 'Pane' as const, requestId: 'apiarius', viewport: { columns: 100, rows: 50, isFullscreen: true }, props: { title: 'Apiarius', isFocused: true, bodyColumns: 96, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const }
  const ui = await $.ui.mount(pane)
  const link = await ui.find({ key: 'web:link' })
  expect(link?.type).toBe('Markdown')
  expect(link?.text).toContain(`[Open the Apiarius deck](http://127.0.0.1:${PORT}/?t=`)
  expect(link?.text).toMatch(/\) in the Browser pane$/)
  // Settings' Open in browser is that link too, which the surface opens itself: no Button that asks the Browser pane
  await ui.press({ key: 'tab:settings' })
  await ui.redraw()
  const open = await ui.find({ key: 'settings:web:link' })
  expect(open?.type).toBe('Markdown')
  expect(open?.text).toMatch(/^\[Open in browser\]\(http:\/\/127\.0\.0\.1:\d+\/\?t=[^)]+\)$/)
  expect(open?.text).toContain(`http://127.0.0.1:${PORT}/?t=`)
  expect(await ui.find({ key: 'web:open' })).toBeUndefined()
  await ui.unmount()
})
