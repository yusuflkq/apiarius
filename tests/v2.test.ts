import { expect, mock, test } from 'claude-code/testing'

import { emptyGit, type GitState } from '../hooks/git'
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
  // an Agent call that started no agent: the deck's own words for it are no result of the agent's
  agent(data, 'agent-none', 'none', { status: 'failed', endedAt: NOW - 30_000, answer: 'Not started: the call was refused' })

  const state = stateOf(data)
  expect(rowOf(state, 'agent-fixer')).toMatchObject({ live: { tool: 'Bash', text: 'npm test -- rateLimit', at: NOW - 20_000 }, model: 'haiku-4.5', tokens: 60, elapsed: '4m', isTaskCut: true })
  expect(rowOf(state, 'agent-fixer').task).toHaveLength(600)
  expect(rowOf(state, M.MAIN)).toMatchObject({ live: { tool: 'Edit', text: 'src/a.ts' }, elapsed: '5m', task: '' })
  expect(rowOf(state, 'agent-done')).toMatchObject({ live: null, status: 'done', elapsed: '4m', isResultCut: true })
  expect(rowOf(state, 'agent-none').result).toBe('')

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
    line: 'opus-5.5 · context 41% · $4.12',
    turn: { id: 'turn-9', at: NOW - 500_000 },
  })
  expect(state.inspect).toMatchObject({ contextPercent: 41.4, costUsd: 4.123 })

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
    { path: 'src/a.ts', code: 'M', added: 3, removed: 2, edits: ['toolu_e1', W.webIdOf('toolu_e2:1')] },
    { path: 'package.json', code: 'M', added: 1, removed: 0, edits: [] },
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
  expect(state.changes.files.map(file => file.edits.length)).toEqual([1, 1, 1, 1, 0])
  expect(state.changes.edits.filter(one => one.isOutside).length).toBe(1)
  expect(state.acks.map(ack => ack.status)).toEqual(['failed', 'delivered', 'queued'])
  expect(rowOf(state, IDS.builder)).toMatchObject({ background: true, status: 'waiting', live: { tool: 'Bash', text: 'npm test -- rateLimit' } })
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
  const file = JSON.parse(W.agentFilesOf(session.data)[0]!.text) as W.V2AgentFile
  expect(W.v2TimesMoved(file, 1000).activity.map(one => one.at)).toEqual(file.activity.map(one => one.at + 1000))

  expect(W.v2StateFromText('{"v":1,"now":1}', later)).toBeNull()
  expect(W.v2StateFromText('not json', later)).toBeNull()
  expect(W.v2StateFromText(JSON.stringify({ ...state, chat: null }), later)).toBeNull()
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

test('the v2 screens` own state in the pane: Now, nothing unfolded, all of Chat, no Inspect; each field set as it is checked, the rest kept, healed from a snapshot', () => {
  const fresh = M.defaultView().v2
  expect(fresh).toEqual({ tab: 'now', openFolds: [], chatFilter: '', isInspectOpen: false })
  const set = M.view2With(fresh, { tab: 'chat', chatFilter: 'agent-x1' })
  expect(set).toEqual({ tab: 'chat', openFolds: [], chatFilter: 'agent-x1', isInspectOpen: false })
  // a tab of none of the three, folds that are no strings, a filter that is none: kept as they were
  expect(M.view2With(set, { tab: 'dashboard', openFolds: ['fold:main', 7, '', 'fold:main', 'fold:b'], chatFilter: 3, isInspectOpen: 'yes' })).toEqual({ tab: 'chat', openFolds: ['fold:main', 'fold:b'], chatFilter: 'agent-x1', isInspectOpen: false })
  expect(M.view2With(set, { openFolds: Array.from({ length: 60 }, (_, i) => `fold:${i}`) }).openFolds).toHaveLength(50)
  // a reload: a view of an earlier build has none, a saved one keeps its own
  expect(M.healView({ tab: 'plan' }).v2).toEqual(fresh)
  expect(M.healView({ ...M.defaultView(), v2: { tab: 'changes', openFolds: ['fold:main'], chatFilter: 'between', isInspectOpen: true } }).v2).toEqual({ tab: 'changes', openFolds: ['fold:main'], chatFilter: 'between', isInspectOpen: true })
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
    ].sort(),
  )
})

test('stopAgent and abortTurn from the page are checked and acked: not in this build yet, said so, never left waiting; refused ones say why', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await work($)
  await clock.advance(400)
  const child = w.children[0]
  const submitted = w.submitted.length
  command(child, { cmd: 'stopAgent', id: 's-1', agentId: 'agent-x1' })
  command(child, { cmd: 'stopAgent', id: 's-2', agentId: M.MAIN })
  command(child, { cmd: 'abortTurn', id: 't-1', turnId: 't1' })
  command(child, { cmd: 'abortTurn', id: 't-2', turnId: 't0' })
  await clock.advance(400)
  expect(lastState(w).acks.map(ack => [ack.id, ack.status, ack.text])).toEqual([
    ['s-1', 'failed', 'Not in this build yet: stop it in Claude Code'],
    ['s-2', 'failed', 'The Orchestrator stops with its turn: Stop turn'],
    ['t-1', 'failed', 'Not in this build yet: press Esc in Claude Code'],
    ['t-2', 'failed', 'That turn has ended'],
  ])
  // nothing reached the session: no send, no prompt
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

  // the sample: no agent runs (builder and reviewer wait on you), so only its needs, each kind counted
  const session = v2Session()
  const sample = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  expect(W.bandOf(sample)).toEqual({
    parts: [
      { kind: 'question', glyph: '?', count: 2, text: '2 questions' },
      { kind: 'permission', glyph: '?', count: 1, text: '1 permission' },
      { kind: 'notification', glyph: '?', count: 1, text: '1 notification' },
    ],
    text: '? 2 questions · ? 1 permission · ? 1 notification',
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

test('/deck`s v2 tabs: now, chat and changes, or the start of one; an earlier build`s tab lands on the one it folded into', () => {
  expect([M.v2TabFor('now'), M.v2TabFor('n'), M.v2TabFor('c'), M.v2TabFor('chat'), M.v2TabFor('chan'), M.v2TabFor(' Changes ')]).toEqual(['now', 'now', 'chat', 'chat', 'changes', 'changes'])
  expect([M.v2TabFor('dashboard'), M.v2TabFor('org'), M.v2TabFor('plan'), M.v2TabFor('stats'), M.v2TabFor('classic'), M.v2TabFor('diffs')]).toEqual(['now', 'now', 'now', 'now', 'now', 'changes'])
  expect([M.v2TabFor(''), M.v2TabFor('web'), M.v2TabFor('demo'), M.v2TabFor('inspect')]).toEqual([undefined, undefined, undefined, undefined])
  expect([M.v2TabOf('dashboard'), M.v2TabOf('changes'), M.v2TabOf('chat'), M.v2TabOf('stats')]).toEqual(['now', 'changes', 'chat', 'now'])
})

test('/deck now, chat and changes open the pane on that v2 tab, /deck inspect (or stats) on Now with Inspect open, and /deck alone on Now; each choice is kept', async ($, on) => {
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
  expect(await v2After('inspect')).toMatchObject({ tab: 'now', isInspectOpen: true })
  expect(await v2After('c')).toMatchObject({ tab: 'chat', isInspectOpen: false })
  expect(await v2After('stats')).toMatchObject({ tab: 'now', isInspectOpen: true })
  expect(await v2After('')).toMatchObject({ tab: 'now', isInspectOpen: false })
  expect(await v2After('changes')).toMatchObject({ tab: 'changes' })
  expect(await v2After('org')).toMatchObject({ tab: 'now' })
  expect(await v2After('now')).toMatchObject({ tab: 'now' })
})
