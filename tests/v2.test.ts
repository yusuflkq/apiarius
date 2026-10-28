import { expect, mock, test } from 'claude-code/testing'

import { hunksOf } from '../hooks/diff'
import { emptyGit, type GitState } from '../hooks/git'
import * as I from '../hooks/inspect'
import * as M from '../hooks/model'
import * as W from '../hooks/web'
import type { DeckAgent, DeckData, DeckMessageKind } from '../types'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { command, deck, lastState, newWorld, work, world } from './world'

/**
 * The v2 view model (`W.deckStateOf`, web/CONTRACT.md v2): the one state the
 * web page, the Desktop pane and the terminal draw. Every rule of "nothing
 * invented" is checked here: no plan without a Claude source, needs only
 * from Claude Code's questions, permission prompts and notifications, the
 * fold rule, chat rows as sentences with no addressee made up, and what a
 * row is titled. Pure: no engine runs.
 */

const NOW = 1_700_000_100_000

function agent(data: DeckData, id: string, name: string, extra: Partial<DeckAgent> = {}): DeckAgent {
  const made = M.newAgent(id, 'agent', name, NOW - 240_000, { type: 'general-purpose', parentId: M.MAIN, status: 'running', ...extra })
  data.agents.push(made)
  return made
}

function stateOf(data: DeckData, extra: { git?: GitState; answerable?: string[] } = {}): W.WebStateV2 {
  return W.deckStateOf(data, extra.git ?? emptyGit(), null, NOW, 's', '/repo', new Set(extra.answerable ?? []))
}

/** The tree as text: each row indented by its depth, a fold row in brackets, a folded member marked. */
function treeOf(state: W.WebStateV2): string[] {
  return state.agents.map(row => `${'  '.repeat(row.depth)}${row.row === 'fold' ? `[${row.text}]` : `${row.title}${row.fold ? ' ·' : ''}`}`)
}

function rowOf(state: W.WebStateV2, id: string): W.V2AgentRow {
  const row = state.agents.find((one): one is W.V2AgentRow => one.row === 'agent' && one.id === id)
  if (!row) throw new Error(`no row ${id}`)
  return row
}

// ---------------------------------------------------------------------------
// The plan: only as Claude made it.

test('no plan without a Claude source: the Orchestrator`s Agent calls, a subagent`s own list and a Workflow with no phases make none', () => {
  const data = M.emptyData(NOW - 600_000)
  M.noteGoal(data, 'goal', { text: 'Add rate limiting to the API', origin: 'composer', at: NOW - 500_000 })
  const goal = data.goals[0]?.id
  const scout = agent(data, 'agent-scout', 'scout', { description: 'Map the routes', goal })
  agent(data, 'agent-builder', 'builder', { description: 'Write the limiter', goal })
  M.noteTodos(scout, [{ content: 'Read src/app.ts', status: 'in_progress', activeForm: 'Reading src/app.ts' }], NOW - 100_000)
  M.noteWorkflow(data, { id: 'wf-1', caller: M.MAIN, name: 'quick', phases: [], at: NOW - 50_000 })

  // v1 made a plan of the Orchestrator's Agent calls; v2 makes none
  expect(M.planOf(data).source).toBe('implicit')
  const state = stateOf(data)
  expect(state.plan).toBeNull()
  // a subagent's list is its own, on its own row, with Claude's statuses
  expect(rowOf(state, 'agent-scout').todos).toEqual([{ text: 'Read src/app.ts', status: 'active', doing: 'Reading src/app.ts' }])
  expect(rowOf(state, 'agent-builder').todos).toEqual([])
})

test('every plan source Claude used shows, each as Claude made it: its board, the Orchestrator`s TodoWrite list, the approved plan as written, Workflow phases', () => {
  const board = M.emptyData(NOW - 600_000)
  const main = M.agentOf(board, M.MAIN)!
  for (const id of ['10', '2', '1']) M.noteBoard(board, main, 'TaskCreate', { subject: `Task ${id}`, activeForm: `Doing task ${id}` }, { task: { id } }, NOW - 400_000)
  M.noteBoard(board, main, 'TaskUpdate', { taskId: '2', status: 'in_progress', owner: 'builder' }, { success: true }, NOW - 300_000)
  M.noteBoard(board, main, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true }, NOW - 200_000)
  // the board alone: by numeric id, Claude's statuses, the owner TaskUpdate named (none is guessed)
  expect(stateOf(board).plan).toEqual({
    board: [
      { id: '1', subject: 'Task 1', status: 'done', owner: null, doing: 'Doing task 1' },
      { id: '2', subject: 'Task 2', status: 'active', owner: 'builder', doing: 'Doing task 2' },
      { id: '10', subject: 'Task 10', status: 'pending', owner: null, doing: 'Doing task 10' },
    ],
    todos: null,
    approved: null,
    workflows: [],
  })

  const todos = M.emptyData(NOW - 600_000)
  M.noteTodos(
    M.agentOf(todos, M.MAIN)!,
    [
      { content: 'Map the routes', status: 'completed', activeForm: 'Mapping the routes' },
      { content: 'Write the limiter', status: 'in_progress', activeForm: 'Writing the limiter' },
      { content: 'Update the docs', status: 'pending' },
    ],
    NOW - 100_000,
  )
  expect(stateOf(todos).plan).toEqual({
    board: [],
    todos: {
      items: [
        { text: 'Map the routes', status: 'done', doing: 'Mapping the routes' },
        { text: 'Write the limiter', status: 'active', doing: 'Writing the limiter' },
        { text: 'Update the docs', status: 'pending' },
      ],
      at: NOW - 100_000,
    },
    approved: null,
    workflows: [],
  })

  // the approved plan as written: its Markdown whole, never split into steps
  const written = '# Rate limiting\n\n1. **Map** the routes.\n2. Write the limiter in `src/rateLimit.ts`.\n\nThen the docs.'
  const approved = M.emptyData(NOW - 600_000)
  M.noteApproved(approved, written, M.MAIN, NOW - 300_000)
  expect(stateOf(approved).plan).toEqual({ board: [], todos: null, approved: { markdown: written, at: NOW - 300_000, by: M.MAIN }, workflows: [] })

  // a Workflow's phases, as its script names them: no phase has a status
  const flow = M.emptyData(NOW - 600_000)
  M.noteWorkflow(flow, { id: 'toolu_wf:1', caller: M.MAIN, name: 'release-check', phases: ['Lint', 'Test', 'Package'], at: NOW - 60_000 })
  expect(stateOf(flow).plan?.workflows).toEqual([{ id: W.webIdOf('toolu_wf:1'), name: 'release-check', phases: ['Lint', 'Test', 'Package'], startedAt: NOW - 60_000, endedAt: null }])

  // all of them at once: each shows, none is chosen over the others
  const all = M.emptyData(NOW - 600_000)
  Object.assign(all, { board: board.board, approved: approved.approved, workflows: flow.workflows })
  M.agentOf(all, M.MAIN)!.todos = M.agentOf(todos, M.MAIN)!.todos
  const plan = stateOf(all).plan!
  expect([plan.board.length, plan.todos?.items.length, plan.approved?.markdown, plan.workflows.length]).toEqual([3, 3, written, 1])
})

// ---------------------------------------------------------------------------
// Needs: only what Claude Code raised.

test('needs come only from Claude Code: its questions, its permission prompts and its notifications that ask, each in its own words; nothing the deck reads into the work', () => {
  const data = M.emptyData(NOW - 600_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  const fixer = agent(data, 'agent-fixer', 'fixer')
  const other = agent(data, 'agent-other', 'other')
  agent(data, 'agent-broke', 'broke', { status: 'failed', endedAt: NOW - 60_000 })
  // two live agents edit one file, one failed: v1 made needs of these
  for (const one of [fixer, other]) {
    M.addEdit(data, one, { id: `e-${one.id}`, agent: one.id, tool: 'Edit', path: 'src/a.ts', abs: '/repo/src/a.ts', at: NOW - 30_000, added: 1, removed: 0, patch: '', isNew: false })
  }
  expect(M.needsOf(data, { isRepo: false, files: [] }, NOW).kind).not.toBe('none')
  // a notification that asks nothing is a chat row, never a need
  M.noteNotification(data, { type: 'skill_build', message: 'Your skill finished building', at: NOW - 20_000 })
  let state = stateOf(data)
  expect(state.needs).toEqual([])
  expect(state.header).toMatchObject({ state: 'working', stateText: 'Working' })
  expect(state.chat.map(row => [row.kind, row.who, row.title, row.text])).toEqual([['notification', 'Claude Code → you', 'skill_build', 'Your skill finished building']])

  // the three sources: a question held on the Orchestrator, a permission prompt on fixer's call, Claude idle for your input
  const question = { question: 'Which store?', header: 'Store', multiSelect: false, options: [{ label: 'Redis', description: 'Shared' }, { label: 'Memory', description: 'Per process' }] }
  M.notePending(data, { id: 'toolu_q', agentId: M.MAIN, kind: 'question', tool: 'AskUserQuestion', at: NOW - 180_000, questions: [question] })
  M.beginTool(data, fixer, M.activityOf('toolu_p', 'Bash', { command: 'npm test -- --watch=false', description: 'Run the tests' }, '/repo', NOW - 120_000))
  M.notePending(data, M.permissionOf({ id: 'toolu_p', tool: 'Bash', input: { command: 'npm test -- --watch=false', description: 'Run the tests' }, agentId: fixer.id, at: NOW - 120_000 }, '/repo'))
  // Claude Code's own notification of that prompt is the same need, not a second
  M.noteNotification(data, { type: 'permission_prompt', message: 'Claude needs your permission to use Bash', agent: fixer.id, at: NOW - 110_000 })
  M.noteNotification(data, { type: 'idle_prompt', message: 'Claude is waiting for your input', title: 'Waiting', at: NOW - 30_000 })
  state = stateOf(data, { answerable: ['toolu_q'] })
  expect(state.needs).toEqual([
    {
      id: 'toolu_q',
      kind: 'question',
      agent: M.MAIN,
      agentName: 'Orchestrator',
      at: NOW - 180_000,
      age: '3m',
      text: 'Which store?',
      questions: [question],
      isAnswerable: true,
    },
    { id: 'toolu_p', kind: 'permission', agent: fixer.id, agentName: 'fixer', at: NOW - 120_000, age: '2m', text: 'Run the tests', isAnswerable: false, tool: 'Bash', command: 'npm test -- --watch=false', description: 'Run the tests' },
    { id: W.webIdOf(`note_${NOW - 30_000}_idle_prompt_main`), kind: 'notification', agent: M.MAIN, agentName: 'Orchestrator', at: NOW - 30_000, age: 'now', text: 'Claude is waiting for your input', isAnswerable: false, type: 'idle_prompt', title: 'Waiting' },
  ])
  // a question whose race this mod instance does not hold (after a reload) is not answerable from the deck
  expect(stateOf(data).needs[0]?.isAnswerable).toBe(false)
  expect(state.header).toMatchObject({ state: 'waiting', stateText: 'Waiting on you' })
  expect([rowOf(state, M.MAIN).needs, rowOf(state, fixer.id).needs, rowOf(state, other.id).needs]).toEqual([2, 1, 0])
  expect([rowOf(state, M.MAIN).status, rowOf(state, fixer.id).status, rowOf(state, other.id).status]).toEqual(['waiting', 'waiting', 'running'])

  // a call let go is no need any more
  M.dropPending(data, 'toolu_q')
  expect(stateOf(data).needs.map(need => need.id)).toEqual(['toolu_p', W.webIdOf(`note_${NOW - 30_000}_idle_prompt_main`)])
  // a notification type the deck does not know, that asks: verbatim, its type as sent
  M.noteNotification(data, { type: 'mcp_oauth', message: 'The github server needs your approval', at: NOW - 5000 })
  expect(stateOf(data).needs.pop()).toMatchObject({ kind: 'notification', type: 'mcp_oauth', text: 'The github server needs your approval' })
})

// ---------------------------------------------------------------------------
// The tree: who started whom, the quiet ones folded.

test('the fold rule: the agents one parent started that finished, failed, stopped or went idle fold into one row with their counts; one at work, one with something at work under it, one that needs you stay out', () => {
  const data = M.emptyData(NOW - 600_000)
  const ended = { endedAt: NOW - 60_000 }
  agent(data, 'agent-a', 'a')
  agent(data, 'agent-a1', 'a1', { parentId: 'agent-a', status: 'completed', ...ended })
  agent(data, 'agent-a2', 'a2', { parentId: 'agent-a', status: 'completed', ...ended })
  agent(data, 'agent-b', 'b', { status: 'completed', ...ended })
  agent(data, 'agent-b1', 'b1', { parentId: 'agent-b', status: 'completed', ...ended })
  agent(data, 'agent-c', 'c', { status: 'failed', ...ended })
  agent(data, 'agent-d', 'd', { status: 'killed', background: true, ...ended })
  agent(data, 'agent-e', 'e', { kind: 'teammate', origin: 'teammate', status: 'idle' })
  agent(data, 'agent-f', 'f', { status: 'completed', ...ended })
  agent(data, 'agent-g', 'g', { parentId: 'agent-f' })
  agent(data, 'agent-h', 'h', { status: 'completed', ...ended })
  M.noteNeeds(data, { kind: 'elicitation_dialog', text: 'h asks for your input', agent: 'agent-h', at: NOW - 10_000 })
  // you and a peer of an earlier build are no rows
  data.agents.push(M.newAgent('peer:other', 'peer', 'other', NOW - 100_000))

  const state = stateOf(data)
  expect(treeOf(state)).toEqual(['Orchestrator', '  a', '    [2 done]', '    a1 ·', '    a2 ·', '  f', '    g', '  h', '  [1 done · 1 failed · 1 stopped · 1 idle]', '  b ·', '    b1 ·', '  c ·', '  d ·', '  e ·'])
  const folds = state.agents.filter((row): row is W.V2FoldRow => row.row === 'fold')
  expect(folds).toEqual([
    { row: 'fold', id: 'fold:agent-a', parent: 'agent-a', depth: 2, ids: ['agent-a1', 'agent-a2'], done: 2, failed: 0, stopped: 0, idle: 0, text: '2 done' },
    { row: 'fold', id: 'fold:main', parent: M.MAIN, depth: 1, ids: ['agent-b', 'agent-c', 'agent-d', 'agent-e'], done: 1, failed: 1, stopped: 1, idle: 1, text: '1 done · 1 failed · 1 stopped · 1 idle' },
  ])
  // the agents a folded one started fold with it, in the same group
  expect([rowOf(state, 'agent-b').fold, rowOf(state, 'agent-b1').fold, rowOf(state, 'agent-a1').fold, rowOf(state, 'agent-f').fold]).toEqual(['fold:main', 'fold:main', 'fold:agent-a', null])
  // stopped is told from failed: its dot says failed, its flag says stopped
  expect(rowOf(state, 'agent-d')).toMatchObject({ status: 'failed', isStopped: true, background: true })
  expect(rowOf(state, 'agent-e')).toMatchObject({ kind: 'teammate', status: 'idle', background: true, parent: M.MAIN, depth: 1 })

  // the Orchestrator never folds, idle or not; with nothing quiet there is no fold row
  const calm = M.emptyData(NOW - 600_000)
  agent(calm, 'agent-x', 'x')
  expect(treeOf(stateOf(calm))).toEqual(['Orchestrator', '  x'])
  expect(rowOf(stateOf(calm), M.MAIN)).toMatchObject({ kind: 'orchestrator', parent: null, depth: 0, fold: null, status: 'idle', elapsed: '' })
})

test('a row is titled by what Claude Code said: its name, else its description cut after a word, else its type, else its short id; namesakes keep the name, told apart by their ids', () => {
  const data = M.emptyData(NOW - 600_000)
  agent(data, 'a1b2c3d4e5f6', 'reviewer', { type: 'Explore' })
  agent(data, 'f6e5d4c3b2a1', 'reviewer', { type: 'Explore' })
  agent(data, 'agent-long', '', { description: 'Read every route of the public API and list the handlers that each one reaches through the middleware' })
  agent(data, 'agent-typed', '', { type: 'Explore' })
  // a loop the deck saw before its spawn: the name it made up and its placeholder type are not Claude Code's
  const seen = M.ensureAgent(data, '9f8e7d6c5b4a', NOW - 60_000)
  const state = stateOf(data)
  expect(state.agents.map(row => (row.row === 'agent' ? [row.title, row.name, row.type, row.shortId] : []))).toEqual([
    ['Orchestrator', '', '', ''],
    ['reviewer', 'reviewer', 'Explore', 'a1b2c3d'],
    ['reviewer', 'reviewer', 'Explore', 'f6e5d4c'],
    ['Read every route of the public API and list the handlers', '', 'general-purpose', 'agent-l'],
    ['Explore', '', 'Explore', 'agent-t'],
    ['9f8e7d6', '', '', '9f8e7d6'],
  ])
  expect(seen.name).toBe('agent-9f8e7d')
  expect(state.agents.some(row => row.row === 'agent' && / \d$/.test(row.title))).toBe(false)
})

test('a row`s call in flight is shown verbatim, tool and what it was given; its task and result are its own, cut at 600 with the whole in its agent file', () => {
  const data = M.emptyData(NOW - 600_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  M.noteMainTurn(data, 'turn-1', NOW - 300_000)
  const fixer = agent(data, 'agent-fixer', 'fixer', { prompt: `Fix it. ${'x'.repeat(900)}`, model: 'claude-haiku-4-5-20251001', tokensIn: 10, tokensOut: 20, cacheRead: 30 })
  M.beginTool(data, fixer, M.activityOf('toolu_1', 'Bash', { command: 'npm test -- rateLimit', description: 'Run the tests' }, '/repo', NOW - 20_000))
  M.beginTool(data, main, M.activityOf('toolu_2', 'Edit', { file_path: '/repo/src/a.ts' }, '/repo', NOW - 5000))
  const done = agent(data, 'agent-done', 'done', { status: 'completed', endedAt: NOW - 30_000, startedAt: NOW - 270_000 })
  M.noteResult(data, done, `All good. ${'y'.repeat(700)}`, NOW - 30_000, 'handback')
  // an Agent call that started no agent (refused), and one that runs in a cloud session: the deck words no result for either
  for (const [id, end] of [
    ['toolu_none', { isStarted: false, why: 'The person declined to start it' }],
    ['toolu_cloud', { isStarted: true, isRemote: true }],
  ] as const) {
    M.addPlaceholder(data, { toolUseId: id, parentId: M.MAIN, description: id, prompt: 'Go', at: NOW - 40_000 })
    M.settleAgentCall(data, { toolUseId: id, at: NOW - 30_000, ...end })
  }

  const state = stateOf(data)
  expect(rowOf(state, 'agent-fixer')).toMatchObject({ live: { tool: 'Bash', text: 'npm test -- rateLimit', at: NOW - 20_000 }, model: 'haiku-4.5', tokens: 60, elapsed: '4m', isTaskCut: true })
  expect(rowOf(state, 'agent-fixer').task).toHaveLength(600)
  expect(rowOf(state, M.MAIN)).toMatchObject({ live: { tool: 'Edit', text: 'src/a.ts' }, elapsed: '5m', task: '' })
  expect(rowOf(state, 'agent-done')).toMatchObject({ live: null, status: 'done', elapsed: '4m', isResultCut: true })
  expect([rowOf(state, 'toolu_none').result, rowOf(state, 'toolu_none').status, rowOf(state, 'toolu_none').isStopped]).toEqual(['', 'failed', true])
  expect([rowOf(state, 'toolu_cloud').result, rowOf(state, 'toolu_cloud').status]).toEqual(['', 'idle'])
  // a snapshot of an earlier build, which wrote words of its own there: healed to none
  const old = M.copyOf(data)
  old.agents.find(one => one.id === 'toolu_none')!.answer = 'Not started: The person declined to start it'
  old.agents.find(one => one.id === 'toolu_cloud')!.answer = 'Runs in a cloud session, outside this view'
  expect(M.healData(old, NOW).agents.filter(one => one.id.startsWith('toolu_')).map(one => one.answer)).toEqual([undefined, undefined])

  const file = JSON.parse(W.agentFilesOf(data).find(one => one.id === W.webIdOf('agent-fixer'))?.text ?? '{}') as W.V2AgentFile
  expect(file).toMatchObject({ v: 2, id: 'agent-fixer', task: fixer.prompt, result: '', todos: [], edits: [] })
  expect(file.activity).toEqual([{ id: 'toolu_1', at: NOW - 20_000, tool: 'Bash', target: 'Run the tests', command: 'npm test -- rateLimit', description: 'Run the tests', ok: null, ms: null }])
  expect(JSON.parse(W.agentFilesOf(data).find(one => one.id === W.webIdOf('agent-done'))?.text ?? '{}').result).toBe(done.answer)
  // each by its row's file id: agents/<fileId>.json
  expect(W.agentFilesOf(data).map(one => one.id)).toEqual(state.agents.flatMap(row => (row.row === 'agent' ? [row.fileId] : [])))
  expect(rowOf(state, 'agent-fixer').fileId).toBe('agent-2dfixer')
})

// ---------------------------------------------------------------------------
// The chat: every message, as a sentence, no addressee made up.

test('chat rows read as sentences: who to whom, agent to agent titled by its summary, the name SendMessage used, and no addressee for words to nobody in particular', () => {
  const data = M.emptyData(NOW - 600_000)
  agent(data, 'agent-scout', 'scout')
  agent(data, 'agent-builder', 'builder')
  const say = (from: string, to: string, kind: DeckMessageKind, text: string, at: number, extra: Record<string, unknown> = {}) => M.addMessage(data, { from, to, kind, text, at, ...extra })
  say(M.YOU, M.MAIN, 'prompt', 'Add rate limiting', NOW - 500_000)
  say(M.MAIN, 'agent-scout', 'spawn', 'Map the routes', NOW - 400_000)
  say('agent-scout', 'agent-builder', 'message', 'The routes are in src/app.ts', NOW - 300_000, { title: 'Routes found', isDelivered: true })
  say('agent-builder', 'ops-bot', 'message', 'Can CI start Redis?', NOW - 250_000, { title: 'A Redis for CI', isDelivered: false })
  say('other-session', M.MAIN, 'message', 'Status from the other session', NOW - 240_000)
  say(M.YOU, 'agent-builder', 'chat', 'Keep it optional', NOW - 200_000, { isDelivered: true, ackId: 'c-1' })
  say('agent-builder', '', 'chat', 'Will do', NOW - 190_000)
  say(M.ENGINE, M.YOU, 'notification', 'Claude is waiting for your input', NOW - 100_000, { title: 'idle_prompt' })
  say(M.ENGINE, M.MAIN, 'task', 'Agent "Map the routes" completed', NOW - 90_000, { title: 'completed', agent: 'agent-scout' })
  say(M.MAIN, M.YOU, 'question', 'Which store?', NOW - 80_000, { callId: 'toolu_q:1' })
  // recorded late, said early: it sits where it was said
  say('agent-scout', M.MAIN, 'result', `Found 14 routes. ${'z'.repeat(800)}`, NOW - 350_000)

  const chat = stateOf(data).chat
  expect(chat.map(row => [row.who, row.from, row.to, row.kind, row.title ?? ''])).toEqual([
    ['You → Orchestrator', M.YOU, M.MAIN, 'prompt', ''],
    ['Orchestrator → scout', M.MAIN, 'agent-scout', 'spawn', ''],
    ['scout → Orchestrator', 'agent-scout', M.MAIN, 'result', ''],
    ['scout → builder', 'agent-scout', 'agent-builder', 'message', 'Routes found'],
    ['builder → ops-bot', 'agent-builder', 'ops-bot', 'message', 'A Redis for CI'],
    ['other-session → Orchestrator', 'other-session', M.MAIN, 'message', ''],
    ['You → builder', M.YOU, 'agent-builder', 'chat', ''],
    ['builder', 'agent-builder', null, 'chat', ''],
    ['Claude Code → you', M.ENGINE, M.YOU, 'notification', 'idle_prompt'],
    ['Claude Code → Orchestrator', M.ENGINE, M.MAIN, 'task', 'completed'],
    ['Orchestrator → you', M.MAIN, M.YOU, 'question', ''],
  ])
  // isDelivered as it was said (true, false), absent where no one said; the send's ack id; a call's id file-safe
  expect(chat.map(row => row.isDelivered)).toEqual([undefined, undefined, undefined, true, false, undefined, true, undefined, undefined, undefined, undefined])
  expect(chat[6]).toMatchObject({ ackId: 'c-1' })
  expect(chat[9]).toMatchObject({ agent: 'agent-scout' })
  expect(chat[10]).toMatchObject({ callId: W.webIdOf('toolu_q:1') })
  // a long one cut at 600, its whole at /message/<id>
  expect(chat[2]).toMatchObject({ isCut: true, id: W.webIdOf(data.messages[data.messages.length - 1]!.id) })
  expect(chat[2]?.text).toHaveLength(600)
  expect(chat.every(row => /^[A-Za-z0-9_-]+$/.test(row.id))).toBe(true)
})

// ---------------------------------------------------------------------------
// The header and the changes.

test('the header: one word for the session, your latest request in your words, the model, context and cost, and the main loop`s running turn', () => {
  const data = M.emptyData(NOW - 600_000)
  const main = M.agentOf(data, M.MAIN)!
  Object.assign(main, { status: 'running', model: 'claude-opus-5-5' })
  M.noteGoal(data, 'goal', { text: 'Add rate limiting to the API', origin: 'composer', at: NOW - 500_000 })
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: 'Add rate limiting to the API', at: NOW - 500_000 })
  M.noteMainTurn(data, 'turn-9', NOW - 500_000)
  let state = W.deckStateOf(data, emptyGit(), { startedAt: NOW - 600_000, contextPercent: 41.4, costUsd: 4.123, limits: [] }, NOW, 's', '/repo')
  expect(state.header).toEqual({
    state: 'working',
    stateText: 'Working',
    goal: { text: 'Add rate limiting to the API', headline: 'Add rate limiting to the API', at: NOW - 500_000, messageId: W.webIdOf(data.messages[0]!.id) },
    model: 'opus-5.5',
    contextPercent: 41.4,
    costUsd: 4.123,
    mode: '',
    line: 'opus-5.5 · context 41% · $4.12',
    turn: { id: 'turn-9', at: NOW - 500_000 },
  })
  expect(state.inspect).toMatchObject({ contextPercent: 41.4, costUsd: 4.123 })
  // the permission mode a classic hook named goes in the line after the model (the default one, as Claude Code's footer, left unsaid)
  I.noteMode(data, { permission_mode: 'auto' })
  expect(W.deckStateOf(data, emptyGit(), { startedAt: NOW - 600_000, contextPercent: 41.4, costUsd: 4.123, limits: [] }, NOW, 's', '/repo').header).toMatchObject({ mode: 'auto mode', line: 'opus-5.5 · auto mode · context 41% · $4.12' })
  I.noteMode(data, { permission_mode: 'default' })
  expect(W.deckStateOf(data, emptyGit(), { startedAt: NOW - 600_000, contextPercent: 41.4, costUsd: 4.123, limits: [] }, NOW, 's', '/repo').header).toMatchObject({ mode: '', line: 'opus-5.5 · context 41% · $4.12' })

  // a later word of yours from the deck is your latest request; the turn ends, the session is idle
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'chat', text: 'Also exempt /health', at: NOW - 60_000 })
  M.endMainTurn(data, 'turn-9')
  main.status = 'idle'
  state = stateOf(data)
  expect(state.header).toMatchObject({ state: 'idle', stateText: 'Idle', goal: { text: 'Also exempt /health' }, line: 'opus-5.5', turn: null, contextPercent: null, costUsd: null })
  expect(rowOf(state, M.MAIN).elapsed).toBe('')
  // nothing asked yet: no goal
  expect(stateOf(M.emptyData(NOW)).header.goal).toBeNull()
})

test('changes: git`s uncommitted files, each with the agents` own edits of it beside it (never git`s hunks tagged by agent), the edits, and the commits', () => {
  const data = M.emptyData(NOW - 600_000)
  const fixer = agent(data, 'agent-fixer', 'fixer')
  const edit = (id: string, path: string, abs: string) => M.addEdit(data, fixer, { id, agent: fixer.id, tool: 'Edit', path, abs, at: NOW - 30_000, added: 2, removed: 1, patch: '@@ -1 +1 @@\n-a\n+b\n', isNew: false })
  edit('toolu_e1', 'src/a.ts', '/repo/src/a.ts')
  edit('toolu_e2:1', 'src/a.ts', '/repo/src/a.ts')
  edit('toolu_e3', '/tmp/scratch.js', '/tmp/scratch.js')
  data.commitsBy['c'.repeat(40)] = fixer.id
  const git: GitState = {
    ...emptyGit(),
    isRepo: true,
    root: '/repo',
    branch: 'main',
    head: 'c'.repeat(40),
    files: [
      { path: 'src/a.ts', code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 3, removed: 2 },
      { path: 'package.json', code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 1, removed: 0 },
    ],
    commits: [{ hash: 'c'.repeat(40), short: 'ccccccc', author: 'sam', at: NOW - 100_000, subject: 'Fix a', files: 1, added: 2, removed: 1 }],
  }
  const { changes } = stateOf(data, { git })
  expect(changes.repo).toMatchObject({ name: 'repo', root: '/repo', branch: 'main' })
  expect(changes.files).toEqual([
    { path: 'src/a.ts', code: 'M', added: 3, removed: 2, edits: ['toolu_e1', W.webIdOf('toolu_e2:1')], diffId: null },
    { path: 'package.json', code: 'M', added: 1, removed: 0, edits: [], diffId: null },
  ])
  expect(changes.edits.map(one => [one.id, one.agent, one.isOutside ?? false])).toEqual([
    ['toolu_e1', fixer.id, false],
    [W.webIdOf('toolu_e2:1'), fixer.id, false],
    ['toolu_e3', fixer.id, true],
  ])
  expect(changes.commits).toEqual([{ hash: 'c'.repeat(40), short: 'ccccccc', subject: 'Fix a', author: 'sam', at: NOW - 100_000, added: 2, removed: 1, files: 1, agent: fixer.id }])
  // outside a repository: no files, no commits; the agents' edits stay
  const none = stateOf(data).changes
  expect([none.repo, none.files, none.commits, none.edits.length]).toEqual([null, [], [], 3])
})

// ---------------------------------------------------------------------------
// The sample, the composer, the commands.

test('the v2 sample (web/fixtures/state.v2.json) holds every part the screens draw, built by the real builder, the same each time', () => {
  const session = v2Session()
  const build = () => W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const state = build()
  expect(JSON.stringify(build())).toBe(JSON.stringify(state))
  expect(state.now).toBe(SAMPLE_NOW)
  // needs: a single-choice question, a multi-select one, a permission prompt, a notification
  expect(state.needs.map(need => [need.kind, need.questions?.[0]?.multiSelect ?? null, need.isAnswerable])).toEqual([
    ['question', false, true],
    ['permission', null, false],
    ['question', true, true],
    ['notification', null, false],
  ])
  // a nested tree, with a fold under the Orchestrator and one under builder
  expect(treeOf(state)).toEqual(['Orchestrator', '  builder', '    [1 done · 1 failed]', '    tester ·', '    Lint the new files ·', '  reviewer', '  [2 done · 1 stopped]', '  researcher ·', '  docs ·', '  scout ·'])
  // agent → agent SendMessage rows, titled by their summaries, and one to a name no agent carries
  expect(state.chat.filter(row => row.kind === 'message').map(row => `${row.who}: ${row.title}`)).toEqual(['builder → reviewer: Limiter ready for review', 'reviewer → builder: Two questions on the window', 'builder → ops-bot: A Redis for CI'])
  expect(state.chat.some(row => row.to === null)).toBe(true)
  expect(state.chat.some(row => row.isCut)).toBe(true)
  // the plan from all four sources; edits, git files with and without them, an edit outside the repository; acks of each outcome
  expect([state.plan?.board.length, state.plan?.todos?.items.length, state.plan?.approved?.markdown.startsWith('# Rate limiting'), state.plan?.workflows.length]).toEqual([3, 4, true, 1])
  expect(state.changes.files.map(file => file.edits.length)).toEqual([1, 2, 1, 1, 0])
  expect(state.changes.edits.filter(one => one.isOutside).length).toBe(1)
  expect(state.acks.map(ack => ack.status)).toEqual(['failed', 'delivered', 'queued'])
  expect(rowOf(state, IDS.builder)).toMatchObject({ background: true, status: 'waiting', live: { tool: 'Bash', text: 'npm test -- rateLimit' } })
  // Now's activity, files and figures: calls still running and one that failed; a file two agents edited, one outside the repository
  expect(state.activity.length).toBeGreaterThanOrEqual(12)
  expect(state.activity.filter(one => one.kind !== 'said' && one.ok === null).map(one => [one.agentName, one.tool, one.text])).toEqual([
    ['reviewer', 'AskUserQuestion', 'Which routes should skip the limiter?'],
    ['builder', 'Bash', 'Run the limiter tests'],
    ['Orchestrator', 'AskUserQuestion', 'Which store should back the limiter in production?'],
  ])
  // the failed: builder's force-push auto mode denied and docs' edit your hook blocked say so (Inspect's decisions), the linter's failed on its own
  expect(state.activity.filter(one => one.ok === false).map(one => [one.agentName, one.tool, one.text, one.ms, one.refused ?? null])).toEqual([
    ['builder', 'Bash', 'Push the limiter', 900, 'denied'],
    ['Lint the new files', 'Bash', 'Lint the new files', 2100, null],
    ['docs', 'Edit', '.env', 120, 'blocked'],
  ])
  // what builder and reviewer said between their calls, among them: never a thought, nor builder's reply to you (Chat has it)
  expect(state.activity.filter(one => one.kind === 'said').map(one => [one.agentName, one.text.slice(0, 24)])).toEqual([
    ['builder', 'Running the limiter test'],
    ['reviewer', 'Checking the window math'],
    ['builder', 'The bench holds 10,000 h'],
    ['builder', "I won't push. A quick be"],
    ['builder', 'Both stores pass in memo'],
    ['builder', 'The limiter is in. Mount'],
    ['builder', "Nothing there yet. I'll "],
  ])
  expect(state.files.map(file => [file.path, file.editors, file.added, file.removed, file.isOutside ?? false])).toEqual([
    ['src/rateLimit.ts', [IDS.builder, IDS.tester], 7, 1, false],
    ['tests/rateLimit.test.ts', [IDS.tester], 4, 0, false],
    ['docs/api.md', [IDS.docs], 3, 1, false],
    ['src/app.ts', [IDS.builder], 2, 1, false],

    ['C:\\Users\\sam\\AppData\\Local\\Temp\\bench.js', [IDS.builder], 3, 0, true],
  ])
  expect(state.figures).toEqual({ running: 0, waiting: 2, done: 3, failed: 1, stopped: 1, plan: { done: 1, total: 3 }, costUsd: 4.12, tokens: 2_305_400, contextPercent: 41, minutes: 40, needs: 4 })
})

test('a recorded v2 state shown now: every time in it moved together, its agent files too; text that is no v2 state reads as none', () => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const later = SAMPLE_NOW + 86_400_000
  const shown = W.v2StateFromText(JSON.stringify(state), later)!
  expect(shown.now).toBe(later)
  expect(shown.session.startedAt).toBe(state.session.startedAt + 86_400_000)
  expect(shown.needs.map(need => need.at)).toEqual(state.needs.map(need => need.at + 86_400_000))
  expect(shown.chat.map(row => row.at)).toEqual(state.chat.map(row => row.at + 86_400_000))
  expect(shown.header.turn?.at).toBe((state.header.turn?.at ?? 0) + 86_400_000)
  expect(rowOf(shown, IDS.builder).live?.at).toBe((rowOf(state, IDS.builder).live?.at ?? 0) + 86_400_000)
  // the ages and counts as they were worded: only the times move
  expect(shown.needs.map(need => need.age)).toEqual(state.needs.map(need => need.age))
  expect(shown.agents.map(row => (row.row === 'agent' ? row.endedAt : null))).toEqual(state.agents.map(row => (row.row === 'agent' && row.endedAt !== null ? row.endedAt + 86_400_000 : null)))
  expect(shown.activity.map(one => one.at)).toEqual(state.activity.map(one => one.at + 86_400_000))
  expect(shown.files.map(file => file.lastAt)).toEqual(state.files.map(file => file.lastAt + 86_400_000))
  expect([shown.figures, shown.activity.map(one => one.ms)]).toEqual([state.figures, state.activity.map(one => one.ms)])
  const file = JSON.parse(W.agentFilesOf(session.data)[0]!.text) as W.V2AgentFile
  expect(W.v2TimesMoved(file, 1000).activity.map(one => one.at)).toEqual(file.activity.map(one => one.at + 1000))

  expect(W.v2StateFromText('{"v":1,"now":1}', later)).toBeNull()
  expect(W.v2StateFromText('not json', later)).toBeNull()
  expect(W.v2StateFromText(JSON.stringify({ ...state, chat: null }), later)).toBeNull()
  // a state of a build before Now's activity, files and figures reads as none: the screens draw them
  for (const key of ['activity', 'files', 'figures'] as const) expect(W.v2StateFromText(JSON.stringify({ ...state, [key]: undefined }), later)).toBeNull()
})

test('the composer: @name sends to that agent (its name, else its short id, any case), words with no @ go to the Orchestrator', () => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd)
  expect(W.recipientOf(state, 'Keep going')).toEqual({ agentId: M.MAIN, title: 'Orchestrator', text: 'Keep going' })
  expect(W.recipientOf(state, '@Builder keep Redis optional')).toEqual({ agentId: IDS.builder, title: 'builder', text: 'keep Redis optional' })
  expect(W.recipientOf(state, '@d2e3f4a run it again')).toEqual({ agentId: IDS.linter, title: 'Lint the new files', text: 'run it again' })
  expect(W.recipientOf(state, '@nobody hi')).toEqual({ error: 'No agent named @nobody in this session' })
  expect(W.recipientOf(state, '@builder   ')).toEqual({ error: 'Nothing to send' })
  expect(W.recipientOf(state, '  ')).toEqual({ error: 'Nothing to send' })
})

test('@ forgives: an id or short id, then the name (or title) whole, at its start, inside it, word by word, lowercased with only a-z and 0-9 kept; those at work or waiting first, then the newest; a tie asks "Did you mean"', () => {
  const session = v2Session()
  const sample = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd)
  const base = rowOf(sample, IDS.builder)
  const row = (id: string, shortId: string, title: string, status: W.V2AgentRow['status'], startedAt: number, name = ''): W.V2AgentRow => ({ ...base, id, shortId, title, name, status, startedAt, isStopped: false, parent: M.MAIN })
  const chat = row('agent-chat', 'a1b2c3d', 'Native Chat as a group chat', 'running', 1000)
  const pane = row('agent-pane', 'b2c3d4e', 'Pane: restore dashboard and org chart', 'done', 2000)
  const web = row('agent-web', 'c3d4e5f', 'Web: restore dashboard, Org tab, git diff', 'running', 3000)
  const robots = row('agent-robots', 'd4e5f6a', 'Robot avatars, first cut', 'done', 500)
  const animated = row('agent-anim', 'e5f6a7b', 'Animated robot avatars + style switcher', 'done', 4000)
  const main = rowOf(sample, M.MAIN)
  const state = { agents: [main, chat, pane, web, robots, animated] }
  const to = (agent: W.V2AgentRow, text = 'hello') => ({ agentId: agent.id, title: agent.title, text })

  // the owner's: the name run together, its start, with a dash, any case
  expect(W.recipientOf(state, '@NativeChat hello')).toEqual(to(chat))
  expect(W.recipientOf(state, '@native hello')).toEqual(to(chat))
  expect(W.recipientOf(state, '@native-chat hello')).toEqual(to(chat))
  expect(W.recipientOf(state, '@NATIVE_CHAT, hello')).toEqual(to(chat))
  // the short id, and the id itself
  expect(W.recipientOf(state, '@A1B2C3D hello')).toEqual(to(chat))
  expect(W.recipientOf(state, '@agent-chat hello')).toEqual(to(chat))
  // inside the name; then each word inside it, in any order
  expect(W.recipientOf(state, '@group hello')).toEqual(to(chat))
  expect(W.recipientOf(state, '@chat-group hello')).toEqual(to(chat))
  expect(W.recipientOf(state, '@GroupNative hello')).toEqual(to(chat))
  // a name that starts with it wins over a newer one that only holds it
  expect(W.recipientOf(state, '@robot hello')).toEqual(to(robots))
  // two hold it: the one at work wins over the one done, though it is older
  expect(W.recipientOf(state, '@dashboard hello')).toEqual(to(web))
  // two done hold it: the newer
  const older = row('agent-old', 'f6a7b8c', 'Old pane polish', 'done', 100)
  const newer = row('agent-new', 'a7b8c9d', 'New pane polish', 'done', 2000)
  expect(W.recipientOf({ agents: [main, older, newer] }, '@polish hello')).toEqual(to(newer))
  // a waiting one counts as at work
  const waiting = { ...older, status: 'waiting' as const }
  expect(W.recipientOf({ agents: [main, waiting, newer] }, '@polish hello')).toEqual(to(waiting))
  // nothing fits, or nothing after the name
  expect(W.recipientOf(state, '@nobody hi')).toEqual({ error: 'No agent named @nobody in this session' })
  expect(W.recipientOf(state, '@--- hi')).toEqual({ error: 'No agent named @--- in this session' })
  expect(W.recipientOf(state, '@NativeChat')).toEqual({ error: 'Nothing to send' })
  // the Orchestrator is the words with no @, never an @name
  expect(W.recipientOf(state, '@Orchestrator hi')).toEqual({ error: 'No agent named @Orchestrator in this session' })

  // two at work, started at once, both start with it: the composer asks which
  const twin = row('agent-twin', 'a9b8c7d', 'Native pane polish', 'running', 1000)
  const tied = W.recipientOf({ agents: [main, chat, twin, pane] }, '@native hello')
  expect(tied).toEqual({
    error: 'Did you mean: Native Chat as a group chat (@a1b2c3d) or Native pane polish (@a9b8c7d)?',
    ambiguous: [
      { agentId: chat.id, title: chat.title, handle: 'a1b2c3d' },
      { agentId: twin.id, title: twin.title, handle: 'a9b8c7d' },
    ],
  })
  // either one, named closer, is found
  expect(W.recipientOf({ agents: [main, chat, twin, pane] }, '@NativeChat hello')).toEqual(to(chat))
  expect(W.recipientOf({ agents: [main, chat, twin, pane] }, '@a9b8c7d hello')).toEqual(to(twin))
  // the rule's pieces
  expect(W.mentionKeyOf('Native Chat: a group chat!')).toBe('nativechatagroupchat')
  expect([W.mentionWordsOf('NativeChat'), W.mentionWordsOf('native-chat'), W.mentionWordsOf('v2Pane_fix')]).toEqual([['native', 'chat'], ['native', 'chat'], ['v2', 'pane', 'fix']])
})

test('the commands v2 adds: stopAgent only for a background agent or a teammate at work, abortTurn only for the main loop`s running turn, answer by the call v2 names', () => {
  const data = M.emptyData(NOW - 600_000)
  agent(data, 'agent-bg', 'bg', { background: true })
  agent(data, 'agent-fg', 'fg', { background: false })
  agent(data, 'agent-mate', 'mate', { kind: 'teammate', origin: 'teammate' })
  agent(data, 'agent-gone', 'gone', { background: true, status: 'completed', endedAt: NOW - 1000 })
  expect(W.routeOf({ cmd: 'stopAgent', agentId: 'agent-bg' }, data)).toEqual({ kind: 'stopAgent', agentId: 'agent-bg' })
  expect(W.routeOf({ cmd: 'stopAgent', agentId: 'agent-mate' }, data)).toEqual({ kind: 'stopAgent', agentId: 'agent-mate' })
  for (const agentId of ['agent-fg', 'agent-gone', M.MAIN, 'agent-nobody']) expect(W.routeOf({ cmd: 'stopAgent', agentId }, data)).toBeNull()
  expect(W.refusalOf({ cmd: 'stopAgent', agentId: 'agent-fg' }, data)).toBe("Only a background agent or a teammate can be stopped: a foreground one ends with its caller's turn (Stop turn)")
  expect(W.refusalOf({ cmd: 'stopAgent', agentId: 'agent-gone' }, data)).toBe('It is not at work')
  expect(W.refusalOf({ cmd: 'stopAgent', agentId: M.MAIN }, data)).toBe('The Orchestrator stops with its turn: Stop turn')

  expect(W.routeOf({ cmd: 'abortTurn' }, data)).toBeNull()
  expect(W.refusalOf({ cmd: 'abortTurn' }, data)).toBe('No turn is running')
  M.noteMainTurn(data, 'turn-2', NOW - 1000)
  expect(W.routeOf({ cmd: 'abortTurn' }, data)).toEqual({ kind: 'abortTurn', turnId: 'turn-2' })
  expect(W.routeOf({ cmd: 'abortTurn', turnId: 'turn-2' }, data)).toEqual({ kind: 'abortTurn', turnId: 'turn-2' })
  expect(W.routeOf({ cmd: 'abortTurn', turnId: 'turn-1' }, data)).toBeNull()
  expect(W.refusalOf({ cmd: 'abortTurn', turnId: 'turn-1' }, data)).toBe('That turn has ended')

  // a call whose id is not file-safe: v2 names it by its web id, and the answer reaches it
  M.notePending(data, { id: 'call:7', agentId: M.MAIN, kind: 'question', tool: 'AskUserQuestion', at: NOW - 1000, questions: [{ question: 'Which?', header: '', multiSelect: false, options: [{ label: 'A', description: '' }] }] })
  expect(stateOf(data).needs[0]?.id).toBe(W.webIdOf('call:7'))
  expect(W.routeOf({ cmd: 'answer', callId: W.webIdOf('call:7'), answers: { 'Which?': 'A' } }, data)).toEqual({ kind: 'answer', callId: 'call:7', answers: { 'Which?': 'A' } })
  expect(W.routeOf({ cmd: 'answer', callId: 'call:7', answers: { 'Which?': 'A' } }, data)).toEqual({ kind: 'answer', callId: 'call:7', answers: { 'Which?': 'A' } })
})

// ---------------------------------------------------------------------------
// The pane's side of v2: its own view state, its lazy files, the sample, the commands.

test('the v2 screens` own state in the pane: the Dashboard (`now`), nothing unfolded, all of Chat; each field set as it is checked, the rest kept, healed from a snapshot; Inspect open is the Inspect tab now', () => {
  const fresh = M.defaultView().v2
  const none = { cleared: [], clearedAt: 0 }
  expect(fresh).toEqual({ tab: 'now', openFolds: [], chatFilter: '', isInspectOpen: false, ...none })
  const set = M.view2With(fresh, { tab: 'chat', chatFilter: 'agent-x1' })
  expect(set).toEqual({ tab: 'chat', openFolds: [], chatFilter: 'agent-x1', isInspectOpen: false, ...none })
  // a tab of none of the five (the Dashboard's id is `now`), folds that are no strings, a filter that is none: kept as they were
  expect(M.view2With(set, { tab: 'dashboard', openFolds: ['fold:main', 7, '', 'fold:main', 'fold:b'], chatFilter: 3, isInspectOpen: 'yes' })).toEqual({ tab: 'chat', openFolds: ['fold:main', 'fold:b'], chatFilter: 'agent-x1', isInspectOpen: false, ...none })
  expect(M.view2With(set, { openFolds: Array.from({ length: 60 }, (_, i) => `fold:${i}`) }).openFolds).toHaveLength(50)
  expect(M.view2With(set, { tab: 'settings' }).tab).toBe('settings')
  expect(M.view2With(set, { tab: 'inspect' }).tab).toBe('inspect')
  // Inspect over a tab, as an earlier build kept it, opens Inspect, a tab of its own
  expect(M.view2With(set, { isInspectOpen: true })).toEqual({ tab: 'inspect', openFolds: [], chatFilter: 'agent-x1', isInspectOpen: false, ...none })
  // what Clear finished hid: ids as strings, each once, the newest 500, and when; anything else kept as it was
  expect(M.view2With(set, { cleared: ['a1', 7, '', 'a1', 'a2'], clearedAt: 1000 })).toMatchObject({ cleared: ['a1', 'a2'], clearedAt: 1000 })
  expect(M.view2With(set, { cleared: 'a1', clearedAt: -1 })).toMatchObject(none)
  expect(M.view2With(set, { cleared: Array.from({ length: 600 }, (_, i) => `a${i}`) }).cleared).toHaveLength(500)
  expect(M.clearedWith(M.view2With(set, { cleared: ['a1'], clearedAt: 5 }), ['a2', 'a1'], 9)).toMatchObject({ cleared: ['a1', 'a2'], clearedAt: 9 })
  // a reload: a view of an earlier build has none, a saved one keeps its own
  expect(M.healView({ tab: 'plan' }).v2).toEqual(fresh)
  expect(M.healView({ ...M.defaultView(), v2: { tab: 'changes', openFolds: ['fold:main'], chatFilter: 'between', isInspectOpen: false } }).v2).toEqual({ tab: 'changes', openFolds: ['fold:main'], chatFilter: 'between', isInspectOpen: false, ...none })
  expect(M.healView({ ...M.defaultView(), v2: { tab: 'changes', openFolds: [], chatFilter: '', isInspectOpen: true } }).v2).toEqual({ tab: 'inspect', openFolds: [], chatFilter: '', isInspectOpen: false, ...none })
  expect(M.healView({ ...M.defaultView(), v2: { tab: 'now', openFolds: [], chatFilter: '', isInspectOpen: false, cleared: ['a1'], clearedAt: 1000 } }).v2).toMatchObject({ cleared: ['a1'], clearedAt: 1000 })
})

test('the lazy files as the pane opens them: an agent`s file, a patch and a cut message`s whole text by the ids the state names, from the live deck or as read', () => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd)
  const files = W.v2FilesOf(session.data)
  const builder = rowOf(state, IDS.builder)
  expect(files.agent(builder.fileId)).toEqual(W.agentFileOf(session.data, M.agentOf(session.data, IDS.builder)!))
  expect(files.agent('nobody')).toBeNull()
  const edit = state.changes.edits[0]!
  expect(files.patch(edit.id)).toBe(session.data.edits[0]!.patch)
  const cut = state.chat.find(row => row.isCut)!
  expect(files.message(cut.id)).toMatch(/^Here is where things stand\./)
  expect(files.message(cut.id)?.length).toBeGreaterThan(cut.text.length)
  // as read from the sample's folder: only what is there, never a key of every object's
  const read = W.v2FilesFrom({ agents: { main: W.agentFileOf(session.data, M.agentOf(session.data, M.MAIN)!) }, patches: { p1: '@@ -1 +1 @@\n' }, messages: {} })
  expect(read.agent('main')?.id).toBe(M.MAIN)
  expect([read.agent('constructor'), read.patch('p1'), read.patch('toString'), read.message('m1')]).toEqual([null, '@@ -1 +1 @@\n', null, null])
})

test('/deck demo reads the v2 sample beside v1: web/fixtures/state.v2.json, then each agent`s file, patch and cut message its state names under web/fixtures/v2', async ($, on) => {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const session = v2Session()
  const v2 = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const v1 = W.webStateOf(session.data, M.defaultView(), session.git, session.usage, session.now, session.sessionId, session.cwd)
  const agentFiles = new Map(W.agentFilesOf(session.data).map(one => [one.id, one.text]))
  const reads: string[] = []
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    reads.push(path)
    if (path.endsWith('/web/fixtures/state.json')) return { value: JSON.stringify(v1) }
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(v2) }
    const agent = /\/web\/fixtures\/v2\/agents\/([^/]+)\.json$/.exec(path)?.[1]
    if (agent && agentFiles.has(agent)) return { value: agentFiles.get(agent)! }
    if (/\/web\/fixtures\/v2\/(patches|messages)\//.test(path)) return { value: 'text\n' }
    return { deny: 'no such file' }
  })
  const w = newWorld()
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  expect((await $.command.run(deck('demo'))).text).toBeUndefined()
  await clock.advance(1000)
  const v2Reads = reads.filter(path => path.includes('/web/fixtures/v2') || path.endsWith('state.v2.json')).map(path => path.replace(/^.*\/web\/fixtures\//, ''))
  expect(v2Reads[0]).toBe('state.v2.json')
  expect(v2Reads.slice(1).sort()).toEqual(
    [
      ...v2.agents.flatMap(row => (row.row === 'agent' ? [`v2/agents/${row.fileId}.json`] : [])),
      ...v2.changes.edits.map(edit => `v2/patches/${edit.id}.diff`),
      ...v2.chat.filter(row => row.isCut).map(row => `v2/messages/${row.id}.md`),
      // Org's Timeline
      'v2/timeline.json',
    ].sort(),
  )
})

test('stopAgent and abortTurn from the page are checked and acked, never left waiting: Stop only where Claude Code`s check allows TaskStop, Stop turn through $.turn.abort; refused ones say why', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  await clock.advance(400)
  const child = w.children[0]
  const submitted = w.submitted.length
  // Claude Code would ask you before TaskStop: the deck does not stop it
  command(child, { cmd: 'stopAgent', id: 's-1', agentId: 'agent-x1' })
  command(child, { cmd: 'stopAgent', id: 's-2', agentId: M.MAIN })
  command(child, { cmd: 'abortTurn', id: 't-2', turnId: 't0' })
  await clock.advance(400)
  command(child, { cmd: 'abortTurn', id: 't-1', turnId: 't1' })
  await clock.advance(400)
  const acks = new Map(lastState(w).acks.map(ack => [ack.id, [ack.status, ack.text]]))
  expect(Object.fromEntries(acks)).toEqual({
    's-1': ['failed', 'Claude Code asks you before TaskStop here: stop it in Claude Code'],
    's-2': ['failed', 'The Orchestrator stops with its turn: Stop turn'],
    't-1': ['delivered', 'Stopped the turn'],
    't-2': ['failed', 'That turn has ended'],
  })
  expect(w.aborted).toEqual(['t1'])
  // Chat says so, from you; nothing else reached the session: no send, no prompt
  const v2 = (lastState(w) as W.WebState & { v2: W.WebStateV2 }).v2
  expect(v2.chat.filter(row => row.kind === 'stop').map(row => [row.from, row.to, row.text])).toEqual([['you', 'main', 'You stopped the turn']])
  expect([w.sent, w.submitted.length]).toEqual([[], submitted])
})

// ---------------------------------------------------------------------------
// The pane's focus (j, k, n), the band's line, /deck's tabs, and an answer in the sample.

test('j and k move among the rows a v2 screen draws, by their Buttons` keys: Now`s needs then its tree (a fold`s members while it is open), Changes` files; none on Chat, a page or Inspect', () => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const needs = state.needs.map(need => `need:${need.id}`)
  const now = { tab: 'now' as const, openFolds: [] as string[], isInspectOpen: false }
  expect(W.focusKeysOf(state, now, '')).toEqual([...needs, 'agent:main', `agent:${IDS.builder}`, `fold:${IDS.builder}`, `agent:${IDS.reviewer}`, 'fold:main'])
  expect(W.focusKeysOf(state, { ...now, openFolds: ['fold:main'] }, '')).toEqual([...needs, 'agent:main', `agent:${IDS.builder}`, `fold:${IDS.builder}`, `agent:${IDS.reviewer}`, 'fold:main', `agent:${IDS.researcher}`, `agent:${IDS.docs}`, `agent:${IDS.scout}`])
  expect(W.focusKeysOf(state, { ...now, tab: 'changes' }, '')).toEqual(state.changes.files.map(file => `file:${file.path}`))
  expect([W.focusKeysOf(state, { ...now, tab: 'chat' }, ''), W.focusKeysOf(state, now, IDS.builder), W.focusKeysOf(state, { ...now, isInspectOpen: true }, '')]).toEqual([[], [], []])
  expect([W.needKeyOf('toolu_1'), W.agentKeyOf('main'), W.fileKeyOf('src/a.ts')]).toEqual(['need:toolu_1', 'agent:main', 'file:src/a.ts'])

  // one row on, held at either end; from none (or one gone), j takes the first and k the last
  const keys = ['a', 'b', 'c']
  expect([W.focusStepOf(keys, 'a', 1), W.focusStepOf(keys, 'c', 1), W.focusStepOf(keys, 'b', -1), W.focusStepOf(keys, 'a', -1)]).toEqual(['b', 'c', 'a', 'a'])
  expect([W.focusStepOf(keys, '', 1), W.focusStepOf(keys, '', -1), W.focusStepOf(keys, 'gone', 1), W.focusStepOf([], '', 1)]).toEqual(['a', 'c', 'a', ''])
  // n: the need after the one focused, round to the first; the first from a row that is none
  expect([W.nextNeedKeyOf(state, ''), W.nextNeedKeyOf(state, needs[0]!), W.nextNeedKeyOf(state, needs[needs.length - 1]!), W.nextNeedKeyOf(state, 'agent:main')]).toEqual([needs[0], needs[1], needs[0], needs[0]])
  expect(W.nextNeedKeyOf({ needs: [] }, '')).toBe('')
})

test('the band says in one line how many agents are at work and what waits on you, by kind; the Orchestrator and Claude Code`s own loops count for none, and with neither it says nothing', () => {
  const data = M.emptyData(NOW - 600_000)
  M.agentOf(data, M.MAIN)!.status = 'running'
  // only the Orchestrator at work, a finished agent, Claude Code's own compaction: no band
  agent(data, 'agent-done', 'done', { status: 'completed', endedAt: NOW - 60_000 })
  agent(data, 'agent-compact', 'compact', { origin: 'engine' })
  expect(W.bandOf(stateOf(data))).toBeNull()
  agent(data, 'agent-a', 'a')
  agent(data, 'agent-b', 'b', { status: 'starting' })
  agent(data, 'agent-c', 'c', { kind: 'teammate' })
  expect(W.bandOf(stateOf(data))).toEqual({ parts: [{ kind: 'working', glyph: '●', count: 3, text: '3 working' }], text: '● 3 working' })
  const question = { question: 'Which store?', header: 'Store', multiSelect: false, options: [{ label: 'Redis', description: '' }] }
  M.notePending(data, { id: 'toolu_q', agentId: M.MAIN, kind: 'question', tool: 'AskUserQuestion', at: NOW - 60_000, questions: [question] })
  expect(W.bandOf(stateOf(data))?.text).toBe('● 3 working · ? 1 question')

  // the sample: no agent runs (builder and reviewer wait on you), so its needs, each kind counted, then what runs in the background and what is scheduled
  const session = v2Session()
  const sample = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  expect(W.bandOf(sample)).toEqual({
    parts: [
      { kind: 'question', glyph: '?', count: 2, text: '2 questions' },
      { kind: 'permission', glyph: '?', count: 1, text: '1 permission' },
      { kind: 'notification', glyph: '?', count: 1, text: '1 notification' },
      { kind: 'background', glyph: '◐', count: 3, text: '3 in the background' },
      { kind: 'scheduled', glyph: '◷', count: 2, text: '2 scheduled' },
    ],
    text: '? 2 questions · ? 1 permission · ? 1 notification · ◐ 3 in the background · ◷ 2 scheduled',
  })
})

test('an answer in the sample stays there: its need goes, a choice row from you says what you answered, the agent that asked works again once nothing else of its waits on you, and the header follows', () => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const [first, , many] = state.needs
  const at = SAMPLE_NOW + 1000
  const one = W.answeredInSample(state, first!.id, { [first!.questions![0]!.question]: 'Redis' }, at)!
  expect(one.words).toBe('Redis')
  expect(one.state.needs.map(need => need.id)).toEqual(state.needs.slice(1).map(need => need.id))
  expect(one.state.chat[one.state.chat.length - 1]).toEqual({ id: W.webIdOf(`sample-choice-${at}`), at, from: 'you', to: M.MAIN, who: 'You → Orchestrator', kind: 'choice', text: 'You answered: Redis', callId: first!.id })
  // the Orchestrator still has the MCP server's notification waiting on it; the session still waits on you
  expect([rowOf(one.state, M.MAIN).needs, rowOf(one.state, M.MAIN).status, one.state.header.state]).toEqual([rowOf(state, M.MAIN).needs - 1, 'waiting', 'waiting'])
  // reviewer's one question answered: reviewer works again
  const two = W.answeredInSample(one.state, many!.id, { [many!.questions![0]!.question]: '/health, /metrics' }, at + 1000)!
  expect([two.words, rowOf(two.state, IDS.reviewer).needs, rowOf(two.state, IDS.reviewer).status]).toEqual(['/health, /metrics', 0, 'running'])
  // the figures follow: a need fewer each time, and reviewer at work again
  expect([state.figures, one.state.figures, two.state.figures].map(figures => [figures.running, figures.waiting, figures.needs])).toEqual([
    [0, 2, 4],
    [0, 2, 3],
    [1, 1, 2],
  ])
  // the sample itself is left as it was; a permission, a need it does not hold, or an answer of nothing is no answer
  expect(state.needs).toHaveLength(4)
  expect([W.answeredInSample(state, state.needs[1]!.id, { x: 'y' }, at), W.answeredInSample(state, 'nobody', { x: 'y' }, at), W.answeredInSample(state, first!.id, {}, at)]).toEqual([null, null, null])

  // the last need answered, with an agent at work: Working
  const data = M.emptyData(NOW - 600_000)
  agent(data, 'agent-a', 'a')
  const question = { question: 'Which store?', header: 'Store', multiSelect: false, options: [{ label: 'Redis', description: '' }] }
  M.notePending(data, { id: 'toolu_q', agentId: M.MAIN, kind: 'question', tool: 'AskUserQuestion', at: NOW - 60_000, questions: [question] })
  const held = stateOf(data)
  expect(held.header.state).toBe('waiting')
  const done = W.answeredInSample(held, 'toolu_q', { 'Which store?': 'Redis' }, NOW)!
  expect([done.state.header.state, done.state.header.stateText, rowOf(done.state, M.MAIN).status, done.state.needs]).toEqual(['working', 'Working', 'running', []])
})

test('/deck`s v2 tabs: dashboard (or now), chat, org, changes, inspect and settings (or help), or the start of one; an earlier build`s tab lands on the one it folded into', () => {
  expect(M.V2_TABS).toEqual(['now', 'chat', 'org', 'changes', 'inspect', 'settings'])
  expect([M.v2TabFor('now'), M.v2TabFor('n'), M.v2TabFor('c'), M.v2TabFor('chat'), M.v2TabFor('chan'), M.v2TabFor(' Changes '), M.v2TabFor('o'), M.v2TabFor('Org')]).toEqual(['now', 'now', 'chat', 'chat', 'changes', 'changes', 'org', 'org'])
  expect([M.v2TabFor('dashboard'), M.v2TabFor('Dashboard'), M.v2TabFor('dash'), M.v2TabFor('d')]).toEqual(['now', 'now', 'now', 'now'])
  expect([M.v2TabFor('settings'), M.v2TabFor('s'), M.v2TabFor('help'), M.v2TabFor('h')]).toEqual(['settings', 'settings', 'settings', 'settings'])
  expect([M.v2TabFor('inspect'), M.v2TabFor('Inspect'), M.v2TabFor('i'), M.v2TabFor('stats')]).toEqual(['inspect', 'inspect', 'inspect', 'inspect'])
  expect([M.v2TabFor('org'), M.v2TabFor('plan'), M.v2TabFor('classic'), M.v2TabFor('diffs')]).toEqual(['org', 'now', 'now', 'changes'])
  expect([M.v2TabFor(''), M.v2TabFor('web'), M.v2TabFor('demo'), M.v2TabFor('nowhere')]).toEqual([undefined, undefined, undefined, undefined])
  expect([M.v2TabOf('dashboard'), M.v2TabOf('changes'), M.v2TabOf('chat'), M.v2TabOf('stats'), M.v2TabOf('org'), M.v2TabOf('plan'), M.v2TabOf('inspect'), M.v2TabOf('settings')]).toEqual(['now', 'changes', 'chat', 'inspect', 'org', 'now', 'inspect', 'settings'])
  expect([M.view2With(M.defaultView2(), { tab: 'org' }).tab, M.view2With(M.defaultView2(), { tab: 'plan' }).tab]).toEqual(['org', 'now'])
})

test('/deck dashboard (or now), chat, org, changes, inspect and settings open the pane on that v2 tab, /deck stats on Inspect, /deck help on Settings, and /deck alone on the Dashboard; each choice is kept', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  const saved: unknown[] = []
  on('state.set', { plugin: 'agent-deck', key: 'snapshot' }, ($, e) => {
    saved.push(JSON.parse(JSON.stringify(e.value)))
    return { value: { isSet: true as const, version: saved.length } }
  })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const v2After = async (args: string) => {
    await $.command.run(deck(args))
    await clock.advance(2000)
    return (saved[saved.length - 1] as { view: { v2: { tab: string; isInspectOpen: boolean } } }).view.v2
  }
  expect(await v2After('chat')).toMatchObject({ tab: 'chat', isInspectOpen: false })
  expect(await v2After('changes')).toMatchObject({ tab: 'changes', isInspectOpen: false })
  expect(await v2After('inspect')).toMatchObject({ tab: 'inspect', isInspectOpen: false })
  expect(await v2After('c')).toMatchObject({ tab: 'chat', isInspectOpen: false })
  expect(await v2After('stats')).toMatchObject({ tab: 'inspect', isInspectOpen: false })
  expect(await v2After('')).toMatchObject({ tab: 'now', isInspectOpen: false })
  expect(await v2After('help')).toMatchObject({ tab: 'settings' })
  expect(await v2After('settings')).toMatchObject({ tab: 'settings' })
  expect(await v2After('changes')).toMatchObject({ tab: 'changes' })
  expect(await v2After('org')).toMatchObject({ tab: 'org' })
  expect(await v2After('dashboard')).toMatchObject({ tab: 'now' })
  expect(await v2After('now')).toMatchObject({ tab: 'now' })
})

test('what a v2 state shows is one key: the same for the same state built at another moment, another once anything it shows moves', () => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  expect(W.v2KeyOf({ ...state, now: state.now + 5000 })).toBe(W.v2KeyOf(state))
  expect(W.v2KeyOf({ ...state, acks: state.acks.slice(1) })).not.toBe(W.v2KeyOf(state))
  expect(W.v2KeyOf({ ...state, header: { ...state.header, stateText: 'Idle' } })).not.toBe(W.v2KeyOf(state))
})

// ---------------------------------------------------------------------------
// Git's own diff of each uncommitted file: changes.files[].diffId and gitdiffs/<id>.diff.

test('git`s own diff of a file: its hunks whole as gitdiffs/<id>.diff holds them, an id that changes with them, on its row of changes.files; null for one the mod has not read', () => {
  const text = W.gitDiffTextOf(hunksOf(['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,2 @@', ' one', '-two', '+three', '@@ -9 +9,2 @@', ' nine', '+ten', ''].join('\n')))
  expect(text).toBe('@@ -1,2 +1,2 @@\n one\n-two\n+three\n@@ -9,1 +9,2 @@\n nine\n+ten\n')
  expect(W.gitDiffTextOf([])).toBe('')
  const id = W.gitDiffIdOf('src/a.ts', text)
  expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
  expect([W.gitDiffIdOf('src/a.ts', text), W.gitDiffIdOf('src/b.ts', text) === id, W.gitDiffIdOf('src/a.ts', `${text}+more\n`) === id]).toEqual([id, false, false])

  const session = v2Session()
  const read = new Map([['src/app.ts', { id, text }]])
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable, read)
  expect(state.changes.files.map(file => [file.path, file.diffId])).toEqual([
    ['src/app.ts', id],
    ['src/rateLimit.ts', null],
    ['tests/rateLimit.test.ts', null],
    ['docs/api.md', null],
    ['package.json', null],
  ])
  // each written once, and the pane opens it by its id
  expect(W.newGitDiffsOf(read, new Set())).toEqual([{ id, text }])
  expect(W.newGitDiffsOf(read, new Set([id]))).toEqual([])
  expect([W.v2FilesOf(session.data, read).gitDiff(id), W.v2FilesOf(session.data).gitDiff(id), W.v2FilesFrom({ agents: {}, patches: {}, messages: {}, gitDiffs: { [id]: text } }).gitDiff(id)]).toEqual([text, null, text])

  // the sample: every git file's diff, its lazy files beside it
  const sample = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable, session.gitDiffs)
  expect(sample.changes.files.every(file => file.diffId !== null && file.diffId === session.gitDiffs.get(file.path)?.id)).toBe(true)
})

test('while the web deck is on, the mod reads git`s diff of each uncommitted file after git, writes each once as gitdiffs/<id>.diff, and names it on its row; a changed diff is another file', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const HEAD = 'b'.repeat(40)
  let appDiff = ['diff --git a/src/app.ts b/src/app.ts', '--- a/src/app.ts', '+++ b/src/app.ts', '@@ -1,3 +1,3 @@', ' const a = 1', '-const b = 2', '+const b = 3', ' export { a, b }', ''].join('\n')
  const diffs: string[][] = []
  const git = (argv: readonly string[]) => {
    const line = argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ exitCode, stdout })
    if (line.includes('rev-parse --show-toplevel')) return out('/work\n')
    if (line.includes('rev-parse --abbrev-ref HEAD')) return out('main\n')
    if (line.includes('rev-parse --verify --quiet HEAD')) return out(`${HEAD}\n`)
    if (line.includes('status --porcelain')) return out(' M src/app.ts\0?? notes.txt\0')
    if (line.includes('--numstat -z HEAD')) return out('1\t1\tsrc/app.ts\0')
    if (line.endsWith('-M -U3 HEAD --')) {
      diffs.push([...argv])
      return out(appDiff)
    }
    return out('', 1)
  }
  const w = newWorld({ git, files: { '/work/notes.txt': 'hello\nworld\n' } })
  world(on, w)
  await work($)
  await clock.advance(2000)

  const written = () => w.writes.filter(one => /[\\/]gitdiffs[\\/][A-Za-z0-9_-]+\.diff$/.test(one.path)).map(one => one.text)
  const lastV2 = () => (JSON.parse([...w.writes].reverse().find(one => /[\\/]state\.json$/.test(one.path))?.text ?? '{}') as { v2: W.WebStateV2 }).v2
  const appText = '@@ -1,3 +1,3 @@\n const a = 1\n-const b = 2\n+const b = 3\n export { a, b }\n'
  expect(diffs.length).toBeGreaterThan(0)
  expect(written().sort()).toEqual([appText, '@@ -0,0 +1,2 @@\n+hello\n+world\n'].sort())
  const idsOf = () => Object.fromEntries(lastV2().changes.files.map(file => [file.path, file.diffId]))
  expect(idsOf()).toEqual({ 'src/app.ts': W.gitDiffIdOf('src/app.ts', appText), 'notes.txt': W.gitDiffIdOf('notes.txt', '@@ -0,0 +1,2 @@\n+hello\n+world\n') })

  // the next read of git finds the file changed again: its new diff is another file, written once; the one before stays as written
  appDiff = appDiff.replace('+const b = 3', '+const b = 4')
  const before = written().length
  await clock.advance(8000)
  const changed = appText.replace('+const b = 3', '+const b = 4')
  expect(written().slice(before)).toEqual([changed])
  expect(idsOf()['src/app.ts']).toBe(W.gitDiffIdOf('src/app.ts', changed))
})

// ---------------------------------------------------------------------------
// Now's Recent activity, Files and figures: the deck's own records, nothing read into them.

test('activity: every agent`s latest calls, the newest 40 of them, newest first; each one`s own description, else its target, verbatim; ok and ms null while it runs', () => {
  const data = M.emptyData(NOW - 600_000)
  const main = M.agentOf(data, M.MAIN)!
  const fixer = agent(data, 'agent-fixer', 'fixer')
  const said = 'Run the tests: `npm test`, "all" of them — 100% <fast>'
  M.beginTool(data, fixer, M.activityOf('toolu_b', 'Bash', { command: 'npm test', description: said }, '/repo', NOW - 40_000))
  M.endTool(fixer, 'toolu_b', false, NOW - 38_000)
  M.beginTool(data, fixer, M.activityOf('toolu_c', 'Bash', { command: 'git status --short' }, '/repo', NOW - 30_000))
  M.endTool(fixer, 'toolu_c', true, NOW - 29_900)
  M.beginTool(data, main, M.activityOf('toolu_g', 'Grep', { pattern: 'TODO\\(.*\\)', path: '/repo/src' }, '/repo', NOW - 20_000))
  M.endTool(main, 'toolu_g', true, NOW - 19_500)
  M.beginTool(data, fixer, M.activityOf('toolu_e:1', 'Edit', { file_path: '/repo/src/a b.ts' }, '/repo', NOW - 10_000))
  const [bash, shell, edit] = fixer.recent
  const grep = main.recent[0]!

  const state = stateOf(data)
  expect(state.activity).toEqual([
    { id: W.webIdOf('toolu_e:1'), at: NOW - 10_000, agent: 'agent-fixer', agentName: 'fixer', tool: 'Edit', text: edit!.target, ok: null, ms: null },
    { id: 'toolu_g', at: NOW - 20_000, agent: M.MAIN, agentName: 'Orchestrator', tool: 'Grep', text: grep.target, ok: true, ms: 500 },
    { id: 'toolu_c', at: NOW - 30_000, agent: 'agent-fixer', agentName: 'fixer', tool: 'Bash', text: shell!.target, ok: true, ms: 100 },
    { id: 'toolu_b', at: NOW - 40_000, agent: 'agent-fixer', agentName: 'fixer', tool: 'Bash', text: said, ok: false, ms: 2000 },
  ])
  // verbatim: the description as the call gave it, else what it was aimed at, with no tool's name or words of the deck's in front
  expect([bash!.description, state.activity.map(one => one.text)]).toEqual([said, ['src/a b.ts', grep.target, 'git status --short', said]])
  expect(state.activity.every(one => !one.text.startsWith(one.tool))).toBe(true)

  // three agents' 14 calls each: the newest 40 of the 42, newest first
  const many = M.emptyData(NOW - 600_000)
  for (const [n, name] of ['a', 'b', 'c'].entries()) {
    const one = agent(many, `agent-${name}`, name)
    for (let i = 0; i < 14; i++) {
      const at = NOW - 100_000 + i * 1000 + n * 100
      M.beginTool(many, one, M.activityOf(`toolu_${name}${i}`, 'Read', { file_path: `/repo/${name}${i}.ts` }, '/repo', at))
      M.endTool(one, `toolu_${name}${i}`, true, at + 50)
    }
  }
  const listed = stateOf(many).activity
  expect(listed).toHaveLength(40)
  expect(listed[0]).toMatchObject({ id: 'toolu_c13', agent: 'agent-c', text: 'c13.ts', ok: true, ms: 50 })
  expect(listed.map(one => one.at)).toEqual(listed.map(one => one.at).sort((x, y) => y - x))
  expect(listed.some(one => one.id === 'toolu_a0' || one.id === 'toolu_b0')).toBe(false)
  expect(stateOf(M.emptyData(NOW)).activity).toEqual([])
})

test('files: every file the agents edited, its editors in the order they first edited it and its lines; the repository`s first, each the one edited last first; nothing read into it', () => {
  const data = M.emptyData(NOW - 600_000)
  const a = agent(data, 'agent-a', 'a')
  const b = agent(data, 'agent-b', 'b')
  const editOf = (who: DeckAgent, id: string, path: string, at: number, added: number, removed: number) =>
    M.addEdit(data, who, { id, agent: who.id, tool: 'Edit', path, abs: path.startsWith('C:') ? path : `C:/repo/${path}`, at, added, removed, patch: '', isNew: false })
  editOf(b, 'e1', 'src/a.ts', NOW - 50_000, 3, 1)
  editOf(a, 'e2', 'src/a.ts', NOW - 40_000, 2, 0)
  editOf(b, 'e3', 'src/a.ts', NOW - 30_000, 1, 1)
  editOf(a, 'e4', 'C:/Users/sam/AppData/Local/Temp/x.js', NOW - 5_000, 4, 0)
  editOf(a, 'e5', 'docs/b.md', NOW - 20_000, 1, 0)

  // both editors at work on one file: no "live" or "shared" word is added, only who and how much
  const git: GitState = { ...emptyGit(), isRepo: true, root: 'C:/repo' }
  expect(stateOf(data, { git }).files).toEqual([
    { path: 'docs/b.md', editors: ['agent-a'], added: 1, removed: 0, lastAt: NOW - 20_000 },
    { path: 'src/a.ts', editors: ['agent-b', 'agent-a'], added: 6, removed: 2, lastAt: NOW - 30_000 },
    { path: 'C:/Users/sam/AppData/Local/Temp/x.js', editors: ['agent-a'], added: 4, removed: 0, lastAt: NOW - 5_000, isOutside: true },
  ])
  // with no repository none is outside: every path is as the deck kept it
  expect(stateOf(data).files.map(file => [file.path, file.isOutside ?? false])).toEqual([
    ['C:/Users/sam/AppData/Local/Temp/x.js', false],
    ['docs/b.md', false],
    ['src/a.ts', false],
  ])
  expect(stateOf(M.emptyData(NOW)).files).toEqual([])
})

test('figures: the agents by status (the Orchestrator and Claude Code`s own loops count for none), the plan only from Claude`s board or todos, the spend, the tokens, the minutes and the needs', () => {
  const data = M.emptyData(NOW - 600_000)
  M.noteGoal(data, 'goal', { text: 'Add rate limiting to the API', origin: 'composer', at: NOW - 500_000 })
  const goal = data.goals[0]?.id
  M.agentOf(data, M.MAIN)!.tokensIn = 1000
  const scout = agent(data, 'agent-scout', 'scout', { goal, tokensIn: 10, tokensOut: 5, cacheRead: 100 })
  agent(data, 'agent-done', 'done', { goal, status: 'completed', endedAt: NOW - 60_000 })
  agent(data, 'agent-failed', 'failed', { goal, status: 'failed', endedAt: NOW - 60_000 })
  agent(data, 'agent-stopped', 'stopped', { goal, status: 'killed', endedAt: NOW - 60_000 })
  agent(data, 'agent-idle', 'idle', { goal, status: 'idle' })
  agent(data, 'agent-compact', '', { origin: 'engine', type: 'compact' })
  // no plan Claude made with statuses: a subagent's own list, an approved plan and a Workflow's phases count for none
  M.noteTodos(scout, [{ content: 'Read src/app.ts', status: 'completed', activeForm: 'Reading src/app.ts' }], NOW - 100_000)
  M.noteApproved(data, '# Rate limiting\n\n1. Map the routes.\n2. Write the limiter.', M.MAIN, NOW - 400_000)
  M.noteWorkflow(data, { id: 'wf-1', caller: M.MAIN, name: 'release-check', phases: ['Lint', 'Test'], at: NOW - 50_000 })
  const state = stateOf(data)
  expect(state.plan).not.toBeNull()
  expect(state.figures).toEqual({ running: 1, waiting: 0, done: 1, failed: 1, stopped: 1, plan: null, costUsd: null, tokens: 1115, contextPercent: null, minutes: 8, needs: 0 })
  expect(stateOf(M.emptyData(NOW - 600_000)).figures).toEqual({ running: 0, waiting: 0, done: 0, failed: 0, stopped: 0, plan: null, costUsd: null, tokens: 0, contextPercent: null, minutes: 10, needs: 0 })

  // what waits on you: the agent waits (the Orchestrator counts for no agent), and each need counts; the spend as /cost says it
  const question = { question: 'Which store?', header: 'Store', multiSelect: false, options: [{ label: 'Redis', description: '' }] }
  M.notePending(data, { id: 'toolu_p', agentId: 'agent-scout', kind: 'permission', tool: 'Bash', at: NOW - 10_000, command: 'npm test' })
  M.notePending(data, { id: 'toolu_q', agentId: M.MAIN, kind: 'question', tool: 'AskUserQuestion', at: NOW - 5000, questions: [question] })
  const usage = { startedAt: NOW - 600_000, contextPercent: 41, costUsd: 4.12, limits: [] }
  expect(W.deckStateOf(data, emptyGit(), usage, NOW, 's', '/repo').figures).toMatchObject({ running: 0, waiting: 1, needs: 2, costUsd: 4.12, contextPercent: 41, plan: null })

  // the plan's count: the board's tasks done of all, even beside the Orchestrator's list; else that list's items
  const board = M.emptyData(NOW - 600_000)
  const main = M.agentOf(board, M.MAIN)!
  for (const id of ['1', '2', '3']) M.noteBoard(board, main, 'TaskCreate', { subject: `Task ${id}` }, { task: { id } }, NOW - 400_000)
  M.noteBoard(board, main, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true }, NOW - 300_000)
  M.noteTodos(main, [{ content: 'One', status: 'completed' }, { content: 'Two', status: 'completed' }], NOW - 200_000)
  expect(stateOf(board).figures.plan).toEqual({ done: 1, total: 3 })
  const todos = M.emptyData(NOW - 600_000)
  M.noteTodos(M.agentOf(todos, M.MAIN)!, [{ content: 'One', status: 'completed' }, { content: 'Two', status: 'in_progress' }, { content: 'Three', status: 'pending' }], NOW - 200_000)
  expect(stateOf(todos).figures.plan).toEqual({ done: 1, total: 3 })
})
