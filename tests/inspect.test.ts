/**
 * Inspect (tab 5): what hooks/inspect.ts records of what Claude Code says
 * (the permission decisions and who made them, the mode and the effort, the
 * compactions, the context as /context breaks it down, what is loaded), the
 * v2 state's `inspect` built from it, the hooks that hear it (driven through
 * the engine), and the tab as the pane and the terminal draw it: four
 * sections folded to one line each, a refused call marked in Recent
 * activity, a compaction a divider in Chat. Nothing invented: a row says
 * what the engine said, and the words that rest on more than one fact say
 * which.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as I from '../hooks/inspect'
import * as M from '../hooks/model'
import { emptyGit } from '../hooks/git'
import * as W from '../hooks/web'
import { bash } from './tools'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { deck, lastState, newWorld, NOW, work, world, type World } from './world'

const SURFACES = ['terminal', 'desktop'] as const

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane(surface: 'terminal' | 'desktop', bodyColumns = 84) {
  return {
    plugin: 'apiarius',
    surface,
    component: 'Pane' as const,
    requestId: 'apiarius',
    viewport: { columns: bodyColumns + 4, rows: 400, isFullscreen: true },
    props: { title: 'Apiarius', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} },
  }
}

type Drawing = { press: (target: { key: string }) => Promise<unknown>; redraw: () => Promise<void> }

/** A press, then the drawing as the pane draws it next. */
async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

/** A built state's Inspect, from `data` as it stands. */
function inspectOf(data: ReturnType<typeof M.emptyData>) {
  return W.deckStateOf(data, emptyGit(), { startedAt: NOW, contextPercent: 41, costUsd: 4.12, limits: [] }, NOW + 60_000, 's', '/repo').inspect
}

test('a permission decision reads as the engine settled it: your rule, your hook, auto mode, your answer in its dialog, a PermissionRequest hook; a question, a plan and a query are none', () => {
  const data = M.emptyData(NOW)
  I.noteMode(data, { permission_mode: 'auto' })
  const check = (id: string, verdict: I.CheckIn['verdict'], tool = 'Bash', input: Record<string, unknown> = { command: `run ${id}` }) => I.noteCheck(data, { id, tool, input, agentId: M.MAIN, verdict, at: NOW, root: null })
  check('a', { decision: 'allow', rule: 'Bash(npm test:*)' })
  I.noteEnd(data, 'a', true)
  check('b', { decision: 'deny', hook: 'PreToolUse', reason: '.env files are off limits' })
  I.noteEnd(data, 'b', false, 'PreToolUse hook blocked it')
  check('c', { decision: 'ask' })
  I.noteDenied(data, 'c', 'Force-pushes to a shared branch')
  I.noteEnd(data, 'c', false, 'Permission denied by auto mode')
  check('d', { decision: 'ask' })
  I.noteDialog(data, 'd')
  I.noteEnd(data, 'd', true)
  check('e', { decision: 'ask' })
  I.noteDialog(data, 'e')
  I.noteEnd(data, 'e', false, 'The user doesn’t want to proceed with this tool use')
  check('f', { decision: 'ask' })
  I.noteEnd(data, 'f', true)
  check('g', { decision: 'ask' })
  I.noteDialog(data, 'g', { behavior: 'deny', message: 'Not on Fridays' })
  check('h', { decision: 'deny', rule: 'Bash(rm:*)' })
  check('i', { decision: 'ask' })
  I.noteDialog(data, 'i')
  check('j', { decision: 'allow' }, 'Read', { file_path: '/repo/src/a.ts' })
  // a question's and a plan's dialogs are your say, and a query (no call) decides nothing
  expect(check('q', { decision: 'ask' }, 'AskUserQuestion', {})).toBeUndefined()
  expect(check('p', { decision: 'ask' }, 'ExitPlanMode', {})).toBeUndefined()
  expect(check('', { decision: 'allow' })).toBeUndefined()

  const words = Object.fromEntries(I.inspectOf(data).decisions.map(d => [d.id, I.decisionWords(d)]))
  expect(words.a).toEqual({ outcome: 'allowed', by: 'rule', text: 'Allowed by your rule', why: 'Bash(npm test:*)' })
  expect(words.b).toEqual({ outcome: 'blocked', by: 'hook', text: 'Blocked by your hook', why: 'PreToolUse: “.env files are off limits”' })
  expect(words.c).toEqual({ outcome: 'denied', by: 'auto', text: 'Denied by auto mode', why: 'Force-pushes to a shared branch' })
  expect(words.d).toEqual({ outcome: 'allowed', by: 'you', text: 'You allowed it', why: 'answered in Claude Code' })
  expect(words.e).toEqual({ outcome: 'denied', by: 'you', text: 'You declined it', why: 'The user doesn’t want to proceed with this tool use' })
  // derived, and says what it rests on
  expect(words.f).toEqual({ outcome: 'allowed', by: 'auto', text: 'Allowed by auto mode', why: 'ran with no dialog, auto mode on' })
  expect(words.g).toEqual({ outcome: 'blocked', by: 'hook', text: 'Blocked by your hook', why: 'PermissionRequest: “Not on Fridays”' })
  expect(words.h).toEqual({ outcome: 'denied', by: 'rule', text: 'Denied by your rule', why: 'Bash(rm:*)' })
  expect(words.i).toEqual({ outcome: 'waiting', by: 'you', text: 'Waiting on you', why: 'its dialog is open in Claude Code' })
  expect(words.j).toEqual({ outcome: 'allowed', by: 'engine', text: 'Allowed', why: '' })
  // a shell call is named by its command, a file by its path
  expect(I.inspectOf(data).decisions.find(d => d.id === 'j')?.target).toBe('/repo/src/a.ts')
  expect(I.inspectOf(data).decisions.find(d => d.id === 'a')?.target).toBe('run a')

  // Recent activity's mark: blocked by a hook, else denied; nothing for a call that ran or is open
  expect([...'abcdefghij'].map(id => I.refusalOf(data, id) ?? '')).toEqual(['', 'blocked', 'denied', '', 'denied', '', 'blocked', 'denied', '', ''])

  // the state: newest first, counted, and one line for the section
  const ins = inspectOf(data)
  expect(ins.permissions.decisions.map(d => d.id)).toEqual([...'jihgfedcba'])
  expect([ins.permissions.total, ins.permissions.denied, ins.permissions.blocked, ins.permissions.waiting]).toEqual([10, 3, 2, 1])
  expect(ins.summary.permissions).toBe('10 decisions · 1 waiting on you · 3 denied · 2 blocked')
  expect(ins.permissions.decisions[0]).toMatchObject({ agent: 'main', agentName: 'Orchestrator', tool: 'Read' })
})

test('the decisions keep the newest 100, a second check of a call replacing its first; the mode and effort are the main loop`s, a subagent`s left out; the header names the mode, the default one left unsaid', () => {
  const data = M.emptyData(NOW)
  for (let i = 0; i < 120; i++) I.noteCheck(data, { id: `c${i}`, tool: 'Read', input: { file_path: `/a/${i}` }, agentId: M.MAIN, verdict: { decision: 'allow' }, at: NOW + i, root: null })
  I.noteCheck(data, { id: 'c119', tool: 'Read', input: { file_path: '/a/119' }, agentId: M.MAIN, verdict: { decision: 'deny', rule: 'Read(/a/**)' }, at: NOW + 200, root: null })
  const decisions = I.inspectOf(data).decisions
  expect(decisions).toHaveLength(100)
  expect([decisions[0]?.id, decisions[99]?.id, decisions[99]?.verdict]).toEqual(['c20', 'c119', 'deny'])

  expect(I.noteMode(data, { permission_mode: 'plan', agent_id: 'agent-x1' })).toBe(false)
  expect(I.noteMode(data, { permission_mode: 'acceptEdits', effort: { level: 'xhigh' } })).toBe(true)
  expect(I.noteMode(data, { permission_mode: 'acceptEdits' })).toBe(false)
  expect([I.inspectOf(data).mode, I.inspectOf(data).effort, I.headerModeOf(data)]).toEqual(['acceptEdits', 'xhigh', 'accept edits'])
  I.noteMode(data, { permission_mode: 'default' })
  expect(I.headerModeOf(data)).toBe('')
  expect(I.modeText('bypassPermissions')).toBe('bypass permissions')
  expect(I.modeText('someNewMode')).toBe('someNewMode')
})

test('a compaction is a chat row of its own, from the loop whose context it was, its words the summary; the Orchestrator`s figures are of its window, an agent`s tokens alone; one refused is in Inspect alone', () => {
  const data = M.emptyData(NOW)
  I.noteBreakdown(data, breakdown(), 200_000, NOW)
  I.noteCompaction(data, { agent: M.MAIN, trigger: 'auto', before: 184_000, after: 36_000, summary: 'Summary of the work so far.', at: NOW + 1 })
  I.noteCompaction(data, { agent: 'agent-r', trigger: 'manual', before: 176_000, after: 44_000, summary: 'The routes so far.', at: NOW + 2 })
  I.noteCompaction(data, { agent: M.MAIN, trigger: 'auto', summary: '', skipped: 'A PreCompact hook blocked it', at: NOW + 3 })
  const rows = data.messages.filter(one => one.kind === 'compaction')
  expect(rows.map(one => [one.from, one.to, one.text])).toEqual([
    [M.MAIN, '', 'Summary of the work so far.'],
    ['agent-r', '', 'The routes so far.'],
  ])
  const state = W.deckStateOf(data, emptyGit(), null, NOW + 60_000, 's', '/repo')
  const chat = state.chat.filter(one => one.kind === 'compaction')
  expect(chat.map(one => one.compaction)).toEqual([
    { trigger: 'auto', before: 184_000, after: 36_000, percentBefore: 92, percentAfter: 18, title: 'Context compacted', figures: '92% → 18% · 184k → 36k tokens · auto' },
    { trigger: 'manual', before: 176_000, after: 44_000, percentBefore: null, percentAfter: null, title: 'agent-r’s context compacted', figures: '176k → 44k tokens · manual' },
  ])
  expect(chat.map(one => one.to)).toEqual([null, null])
  expect(state.inspect.compactions.map(one => [one.text, one.summary, one.skipped ?? ''])).toEqual([
    ['Orchestrator · auto · 92% → 18%', 'Summary of the work so far.', ''],
    ['agent-r · manual · 176k → 44k tokens', 'The routes so far.', ''],
    ['Orchestrator · auto · not compacted', '', 'A PreCompact hook blocked it'],
  ])
  expect(state.inspect.compactions[0]?.id).toBe(W.webIdOf(rows[0]!.id))
  // the context's line counts the compactions that stood
  expect(state.inspect.summary.context).toBe('41% · compacted 2 times')
})

/** A /context breakdown as `$.session.usage({ breakdown })` gives one. */
function breakdown(): I.BreakdownIn {
  return {
    categories: [
      { name: 'System prompt', tokens: 3_100, kind: 'used', color: 'promptBorder' },
      { name: 'Messages', tokens: 79_100, kind: 'used', color: '#a78bfa' },
      { name: 'Free space', tokens: 84_800, kind: 'free', color: 'promptBorder' },
      { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer', color: 'inactive' },
      { name: 'MCP tools (deferred)', tokens: 4_100, kind: 'deferred', color: 'inactive' },
    ],
    totalTokens: 82_200,
    rawMaxTokens: 200_000,
    percentage: 41,
    model: 'claude-opus-5-5',
    memoryFiles: [
      { path: '/home/sam/.claude/CLAUDE.md', type: 'User', tokens: 310 },
      { path: '/repo/CLAUDE.md', type: 'Project', tokens: 1_480 },
      { path: '/home/sam/.claude/projects/repo/memory/MEMORY.md', type: 'AutoMem', tokens: 160 },
    ],
    mcpTools: [
      { name: 'mcp__github__get_pull_request', serverName: 'github', tokens: 500, isLoaded: true },
      { name: 'mcp__github__list_checks', serverName: 'github', tokens: 500, isLoaded: false },
    ],
    skills: { totalSkills: 3, skillFrontmatter: [{ name: 'code-review' }, { name: 'run' }, { name: 'init' }] },
    autoCompactThreshold: 166_000,
    isAutoCompactEnabled: true,
  }
}

test('the context as /context breaks it down, and what is loaded: the instruction and memory files, why each loaded, the skills (and those run), the MCP servers (and their calls), the settings` hooks and what their event decided', () => {
  const data = M.emptyData(NOW)
  I.noteBreakdown(data, breakdown(), 200_000, NOW)
  I.noteInstructions(data, [{ path: '/repo/CLAUDE.md', kind: 'project', content: 'one\ntwo\nthree\n' }], NOW)
  I.noteInstructionLoaded(data, { path: '/repo/CLAUDE.md', memoryType: 'Project', reason: 'session_start' }, NOW)
  I.noteInstructionLoaded(data, { path: '/repo/src/CLAUDE.md', memoryType: 'Project', reason: 'nested_traversal', trigger: '/repo/src/app.ts' }, NOW)
  I.noteLoaded(data, { model: 'claude-opus-5-5', outputStyle: 'Explanatory', hooks: [...I.hooksOf({ hooks: { PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node guard.js' }] }] } }, 'project'), ...I.hooksOf({ env: { A: 'b' } }, 'user')] }, NOW)
  I.noteCall(data, 'Skill', { skill: 'run' }, NOW)
  I.noteCall(data, 'Skill', { skill: 'run' }, NOW + 1)
  I.noteCall(data, 'Skill', { skill: 'code-review' }, NOW + 2)
  I.noteCall(data, 'mcp__github__list_checks', {}, NOW)
  I.noteCheck(data, { id: 'x', tool: 'Edit', input: { file_path: '/repo/.env' }, agentId: M.MAIN, verdict: { decision: 'deny', hook: 'PreToolUse', reason: 'no secrets' }, at: NOW, root: '/repo' })
  I.noteMode(data, { permission_mode: 'auto', effort: { level: 'high' } })
  const ins = inspectOf(data)

  expect(ins.context).toMatchObject({ text: '82.2k of 200k', percent: 41, autoCompactPercent: 83, model: 'opus-5.5' })
  expect(ins.context?.rows.map(row => [row.name, row.kind, row.hue])).toEqual([
    ['System prompt', 'used', '#9ca3af'],
    ['Messages', 'used', '#a78bfa'],
    ['Free space', 'free', '#2a2a2a'],
    ['Autocompact buffer', 'buffer', '#3f3f46'],
    ['MCP tools (deferred)', 'deferred', '#8a8a8a'],
  ])
  const loaded = ins.loaded!
  expect([loaded.model, loaded.effort, loaded.outputStyle, loaded.mode]).toEqual(['opus-5.5', 'high', 'Explanatory', 'auto mode'])
  expect(loaded.instructions.map(file => [file.name, file.kindText, file.lines, file.tokens, file.how])).toEqual([
    ['~/.claude/CLAUDE.md', 'yours, for every project', null, 310, ''],
    ['/repo/CLAUDE.md', 'this project', 3, 1_480, 'loaded at start'],
    ['src/CLAUDE.md', 'this project', null, null, 'loaded on reading app.ts'],
  ])
  expect(loaded.memory.map(file => [file.name, file.kindText])).toEqual([['MEMORY.md', 'memory']])
  expect(loaded.skills).toEqual({ total: 3, names: ['code-review', 'run', 'init'], used: [{ name: 'run', count: 2 }, { name: 'code-review', count: 1 }] })
  expect(loaded.mcp).toEqual([{ server: 'github', tools: 2, deferred: 1, calls: 1 }])
  // a source's other keys (env) never cross: its hooks alone
  expect(loaded.hooks).toEqual([{ event: 'PreToolUse', matcher: 'Edit|Write', command: 'node guard.js', source: 'project', sourceText: 'project' }])
  expect(loaded.hookEvents).toEqual([{ event: 'PreToolUse', decided: 1, blocked: 1 }])
  expect(ins.summary.loaded).toBe('3 instruction files · 1 memory file · 3 skills · 1 MCP server · 1 hook')
  expect(ins.summary.spend).toBe('≈$4.12')
})

test('a snapshot of an earlier build holds no Inspect: its state reads as nothing heard, every section empty, and the first record makes it whole', () => {
  const data = M.emptyData(NOW)
  const ins = inspectOf(data)
  expect([ins.mode, ins.modeText, ins.context, ins.compactions, ins.permissions.total, ins.loaded]).toEqual(['', '', null, [], 0, null])
  expect(ins.summary).toEqual({ context: '41%', permissions: '', loaded: '', spend: '≈$4.12' })
  data.inspect = { mode: 7 } as unknown as typeof data.inspect
  expect(I.inspectOf(data).decisions).toEqual([])
  I.noteMode(data, { permission_mode: 'auto' })
  expect(I.inspectOf(data)).toMatchObject({ mode: 'auto', decisions: [], compactions: [], skillsUsed: {}, mcpCalls: {} })
})

// ---------------------------------------------------------------------------
// Through the engine: the hooks that hear it.

/** The engine with /context's breakdown, the settings' sources and a compaction's result beneath the deck. */
function inspectWorld(on: On, w: World) {
  on('session.usage', { breakdown: 'summary' }, ($, e) => ({
    value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 82_200, percent: 41, ...(e.breakdown ? { breakdown: { ...breakdown(), gridRows: [], agents: [], apiUsage: null, maxTokens: 200_000, autocompactSource: 'auto' } as never } : {}) }, rateLimits: [], cost: { usd: 1.25 } },
  }))
  on('settings.read', ($, e) => ({ value: e.source === 'project' ? { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node guard.js' }] }] } } : e.source === undefined ? { outputStyle: 'Explanatory' } : {} }))
  on('config.list', () => ({ value: [] }))
  on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'Summary: the limiter is half done.', toolUses: [] }], tokensBefore: 150_000, tokensAfter: 30_000 }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks, ...(e.instructionFiles ? { instructionFiles: e.instructionFiles } : {}) }))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.InstructionsLoaded', () => ({}))
  world(on, w)
}

/** The v2 state the deck wrote last. */
function v2Of(w: World): W.WebStateV2 {
  return (lastState(w) as unknown as { v2: W.WebStateV2 }).v2
}

test('through the hooks: the session`s start reads what is loaded and /context`s breakdown; tool.check, auto mode`s refusal and the call`s end make a decision and mark the call; a classic hook names the mode; a compaction is a chat row; prompt.context and InstructionsLoaded name the files', async ($: Engine, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld({ holding: ['Bash'] })
  inspectWorld(on, w)
  await work($)
  await clock.settle()
  await clock.advance(400)
  let state = v2Of(w)
  // the start: the model, the output style, the project's hook, the breakdown
  expect(state.inspect.loaded).toMatchObject({ modelId: 'claude-test', outputStyle: 'Explanatory', hooks: [{ event: 'PreToolUse', matcher: 'Bash', command: 'node guard.js', source: 'project' }] })
  expect(state.inspect.context).toMatchObject({ text: '82.2k of 200k', percent: 41 })

  // the mode, as a classic hook's input names it
  await $.classic.UserPromptSubmit({ prompt: 'go on', permission_mode: 'auto', effort: { level: 'high' } } as never)
  await clock.advance(400)
  state = v2Of(w)
  expect(state.header).toMatchObject({ mode: 'auto mode', line: 'test · auto mode · context 12% · ≈$1.25' })

  // a force-push: the engine puts it to the mode's decider, auto mode refuses it, the call ends refused
  const input = { command: 'git push --force origin main', description: 'Push it' }
  const call = $.tool.call(bash({ tool_use_id: 'toolu_push', ...input }))
  await clock.settle()
  await $.tool.check({ tool: 'Bash', input, tool_use_id: 'toolu_push' })
  await $.classic.PermissionDenied({ tool_name: 'Bash', tool_input: input, tool_use_id: 'toolu_push', reason: 'Force-pushes to a shared branch' })
  w.held[0]?.settle({ deny: 'Permission for this action has been denied by auto mode.' })
  await call
  await clock.advance(400)
  state = v2Of(w)
  expect(state.inspect.permissions.decisions[0]).toMatchObject({ id: 'toolu_push', tool: 'Bash', target: 'git push --force origin main', outcome: 'denied', by: 'auto', text: 'Denied by auto mode', why: 'Force-pushes to a shared branch' })
  expect(state.activity.find(one => one.id === 'toolu_push')).toMatchObject({ ok: false, refused: 'denied' })

  // a compaction stands: a chat row from the Orchestrator, to nobody; a precompute is none
  const before = [{ role: 'user' as const, text: 'Add rate limiting', toolUses: [] }]
  await $.session.compact({ trigger: 'auto', messages: before })
  await $.session.compact({ trigger: 'precompute', messages: before })
  await clock.advance(400)
  state = v2Of(w)
  expect(state.chat.filter(one => one.kind === 'compaction').map(one => [one.from, one.to, one.text, one.compaction?.figures])).toEqual([[M.MAIN, null, 'Summary: the limiter is half done.', '75% → 15% · 150k → 30k tokens · auto']])
  expect(state.inspect.compactions).toHaveLength(1)

  // the instruction files: those the conversation carries, and one loaded on reading a file under it
  await $.prompt.context({ blocks: [], instructionFiles: [{ path: '/work/CLAUDE.md', kind: 'project', content: 'a\nb' }] })
  await $.classic.InstructionsLoaded({ file_path: '/work/src/CLAUDE.md', memory_type: 'Project', load_reason: 'nested_traversal', trigger_file_path: '/work/src/range.js' })
  await clock.advance(400)
  state = v2Of(w)
  expect(state.inspect.loaded?.instructions.map(file => [file.name, file.lines, file.how])).toEqual(
    expect.arrayContaining([
      ['/work/CLAUDE.md', 2, ''],
      ['src/CLAUDE.md', null, 'loaded on reading range.js'],
    ]),
  )
})

test('a refusal reads as one however Claude Code hands it back: as a hook`s deny, or (as 2.1.311 does for your rule, your hook, a declined dialog, auto mode, a stopped turn) as an error no PostToolUse heard; an error after PostToolUseFailure is a call that ran and failed', () => {
  expect(I.refusalOfEnd({ deny: 'Not here' }, false)).toBe('Not here')
  expect(I.refusalOfEnd({ isError: true, text: 'WebFetch denied access to domain:example.com.' }, false)).toBe('WebFetch denied access to domain:example.com.')
  expect(I.refusalOfEnd({ isError: true }, false)).toBe('')
  // it ran: PostToolUse or PostToolUseFailure fired for it
  expect(I.refusalOfEnd({ isError: true, text: 'Exit code 3' }, true)).toBeUndefined()
  expect(I.refusalOfEnd({ text: 'ok' }, false)).toBeUndefined()
})

test('through the hooks, as Claude Code 2.1.311 ends them: a call its check denied (your rule, your hook) ends in an error with no PostToolUse, and reads refused, in Recent activity too; one that ran and failed (PostToolUseFailure) reads allowed', async ($: Engine, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld({ holding: ['Bash', 'Write', 'WebFetch'] })
  inspectWorld(on, w)
  on('classic.PostToolUse', () => ({}))
  on('classic.PostToolUseFailure', () => ({}))
  await work($)
  await clock.settle()

  /**
   * A call as the engine runs it: its check (`verdict`) beneath the deck's
   * hooks, which refuses it there on a deny; else the tool, held, ends in an
   * error (`failed`) after the engine's PostToolUseFailure.
   */
  const run = async (id: string, tool: string, input: Record<string, unknown>, verdict: 'allow' | 'deny', failed?: string) => {
    w.verdict = verdict
    const call = $.tool.call({ tool, ...input, tool_use_id: id } as never)
    await clock.settle()
    const held = w.held.find(one => one.id === id)
    if (held) w.held.splice(w.held.indexOf(held), 1)
    if (held && failed === undefined) {
      held.settle({ deny: 'the test held a call it meant refused' })
      return 'held'
    }
    held?.settle({ isError: true, result: `Error: ${failed}`, text: failed } as never)
    const ended = await call
    await clock.advance(400)
    return ended
  }
  // Claude Code hands each refusal back as an error, not a deny
  expect(await run('toolu_rule', 'WebFetch', { url: 'https://example.com', prompt: 'title?' }, 'deny')).toMatchObject({ isError: true })
  expect(await run('toolu_env', 'Write', { file_path: '/work/.env', content: 'X=1' }, 'deny')).toMatchObject({ isError: true })
  expect(await run('toolu_fail', 'Bash', { command: 'node -e "process.exit(3)"', description: 'Exit 3' }, 'allow', 'Exit code 3')).toMatchObject({ isError: true })

  const state = v2Of(w)
  const decided = Object.fromEntries(state.inspect.permissions.decisions.map(d => [d.id, [d.outcome, d.text, d.why]]))
  // the engine's own verdicts carry no rule or hook here: a deny reads by its reason
  expect(decided.toolu_rule).toEqual(['denied', 'Denied', ''])
  expect(decided.toolu_env).toEqual(['denied', 'Denied', ''])
  expect(decided.toolu_fail).toEqual(['allowed', 'Allowed', ''])
  const marks = Object.fromEntries(state.activity.map(one => [one.id, [one.ok, one.refused ?? '']]))
  expect(marks).toMatchObject({ toolu_rule: [false, 'denied'], toolu_env: [false, 'denied'], toolu_fail: [false, ''] })
})

// ---------------------------------------------------------------------------
// The tab, as the pane and the terminal draw it.

/** The v2 sample as `/apiarius demo` reads it. */
function sample(on: On, patch: (state: W.WebStateV2) => W.WebStateV2 = state => state) {
  const session = v2Session()
  const built = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  // the refused calls brought among Recent activity's ten newest (the sample's newest are others' searches)
  const v2 = patch({ ...built, activity: built.activity.map(one => (one.refused ? { ...one, at: session.now - 30_000 } : one)).sort((a, b) => b.at - a.at) })
  const v1 = W.webStateOf(session.data, M.defaultView(), session.git, session.usage, session.now, session.sessionId, session.cwd)
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.json')) return { value: JSON.stringify(v1) }
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(v2) }
    return { deny: 'no such file' }
  })
  return v2
}

/** The engine, the v2 sample read (as `patch` makes it), and `/apiarius demo` shown. */
async function demo($: Engine, on: On, patch?: (state: W.WebStateV2) => W.WebStateV2) {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const v2 = sample(on, patch)
  on('ui.focus', () => ({}))
  world(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  return v2
}

/** The elements and characters a drawn tree holds, and how deep it nests, as the desktop's bounds count them. */
function boundsOf(node: unknown, depth = 1): { nodes: number; chars: number; depth: number } {
  if (node === null || node === undefined || typeof node === 'boolean') return { nodes: 0, chars: 0, depth: 0 }
  if (typeof node !== 'object') return { nodes: 1, chars: String(node).length, depth }
  const props = (node as { props?: Record<string, unknown> }).props ?? {}
  let chars = Object.values(props).reduce((sum: number, value) => sum + (typeof value === 'string' ? value.length : 0), 0)
  let nodes = 1
  let deepest = depth
  for (const child of (node as { children?: unknown[] }).children ?? []) {
    const one = boundsOf(child, depth + 1)
    nodes += one.nodes
    chars += one.chars
    deepest = Math.max(deepest, one.depth)
  }
  return { nodes, chars, depth: deepest }
}

test('Inspect on the pane and the terminal: four sections folded to one line each; Permissions, Context, Loaded and Spend open by their heads, each as the state holds it, all open inside the desktop`s bounds', async ($, on) => {
  const v2 = await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:inspect')
    // folded: the four heads in order, each its one line
    const heads = (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => key.startsWith('fold:inspect:'))
    expect(heads).toEqual(['fold:inspect:context', 'fold:inspect:permissions', 'fold:inspect:loaded', 'fold:inspect:spend'])
    expect((await ui.find({ key: 'inspect:context' }))?.text).toContain('· 41% · compacted 2 times')
    expect((await ui.find({ key: 'inspect:permissions' }))?.text).toContain('· 7 decisions · 1 waiting on you · 1 denied · 1 blocked')
    expect((await ui.find({ key: 'inspect:permissions' }))?.text).toContain('auto mode')
    expect((await ui.find({ key: 'inspect:loaded' }))?.text).toContain('· 3 instruction files · 4 memory files · 23 skills · 2 MCP servers · 2 hooks')
    expect(await ui.find({ key: 'perm:list' })).toBeUndefined()

    // Permissions: every decision, newest first: who, the tool, what; who decided and why; when
    await press(ui, 'fold:inspect:permissions')
    const rows = (await ui.findAll({ type: 'Box' })).map(one => one.key ?? '').filter(key => key.startsWith('perm:') && key !== 'perm:list')
    expect(rows).toEqual(v2.inspect.permissions.decisions.map(d => `perm:${d.id}`))
    const push = (await ui.find({ key: 'perm:toolu_01BldB1' }))?.text ?? ''
    for (const said of ['builder', 'Bash', 'git push --force origin main', 'Denied by auto mode', 'Force-pushing to main']) expect(push).toContain(said)
    expect((await ui.find({ key: 'perm:toolu_01DocE0' }))?.text).toContain('Blocked by your hook· PreToolUse: “.env files are off limits”')
    expect((await ui.find({ key: 'perm:toolu_01TstB1' }))?.text).toContain('Allowed by your rule· Bash(npm test:*)')
    expect((await ui.find({ key: 'perm:toolu_01BldE1' }))?.text).toContain('You allowed it')
    // a name opens its agent's page
    await press(ui, 'perm:open:toolu_01BldB1')
    expect((await ui.find({ key: 'page:head' }))?.text).toContain('builder')
    await press(ui, 'key:b')

    // Context: its figures, its bar (an image where Svg draws, block characters on the terminal), its rows, the compactions
    await press(ui, 'fold:inspect:context')
    expect((await ui.find({ key: 'ctx:figures' }))?.text).toContain('82.2k of 200k· 41% · auto-compacts at 83% · opus-5.5')
    const bar = await ui.find({ key: 'ctx:bar' })
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some(one => String(one.props.alt) === 'Context: 82.2k of 200k')).toBe(true)
    else expect(bar?.text).toMatch(/^█+░+▒+$/)
    expect((await ui.find({ key: 'ctx:row:Messages' }))?.text).toContain('54k')
    expect((await ui.find({ key: 'ctx:row:MCP tools (deferred)' }))?.text).toContain('MCP tools (deferred)4.1k')
    const compactions = (await ui.find({ key: 'ctx:compactions' }))?.text ?? ''
    expect(compactions).toContain('researcher · auto · 176k → 44k tokens')
    expect(compactions).toContain('Orchestrator · auto · 92% → 18%')

    // Loaded: each group as the state lists it
    await press(ui, 'fold:inspect:loaded')
    expect((await ui.find({ key: 'loaded:model' }))?.text).toContain('opus-5.5')
    expect((await ui.find({ key: 'loaded:model' }))?.text).toContain('effort high · output style default')
    expect((await ui.find({ key: 'loaded:file:0' }))?.text).toContain('~/.claude/CLAUDE.md')
    expect((await ui.find({ key: 'loaded:file:2' }))?.text).toContain('loaded on reading app.ts')
    expect((await ui.find({ key: 'loaded:memory' }))?.text).toContain('Memory · 4 files')
    expect((await ui.find({ key: 'loaded:skills' }))?.text).toContain('used this session: code-review, run')
    expect((await ui.find({ key: 'loaded:mcp:github' }))?.text).toContain('12 tools · 2 loaded on demand · used 4 times')
    expect((await ui.find({ key: 'loaded:g:hooks' }))?.text).toContain('PreToolUse hooks decided 1 call, blocked 1')

    // all four open stay inside the desktop's bounds
    await press(ui, 'fold:inspect:spend')
    if (surface === 'desktop') {
      const bounds = boundsOf(await ui.drawn())
      expect(bounds.nodes).toBeLessThan(2000)
      expect(bounds.chars).toBeLessThan(262_144)
      expect(bounds.depth).toBeLessThan(32)
    }
    for (const id of ['context', 'permissions', 'loaded', 'spend']) await press(ui, `fold:inspect:${id}`)
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('Recent activity marks a call auto mode denied "⊘ denied" and one your hook blocked "⊘ blocked"; Chat draws each compaction as a divider line, whoever`s context it was', async ($, on) => {
  const v2 = await demo($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'act:toolu_01BldB1' }))?.text).toContain('⊘ denied')
    expect((await ui.find({ key: 'act:toolu_01DocE0' }))?.text).toContain('⊘ blocked')
    await press(ui, 'tab:chat')
    const [theirs, mine] = v2.chat.filter(one => one.kind === 'compaction')
    expect((await ui.find({ key: `msg:${theirs!.id}` }))?.text).toMatch(/researcher’s context compacted.*176k → 44k tokens · auto · \d+m/)
    expect((await ui.find({ key: `msg:${mine!.id}` }))?.text).toMatch(/Context compacted.*92% → 18% · 184k → 36k tokens · auto · \d+m/)
    if (surface === 'terminal') expect((await ui.find({ key: `msg:${mine!.id}` }))?.text).toMatch(/^── Context compacted/)
    else expect((await ui.findAll({ type: 'Svg' })).some(one => String(one.props.alt) === 'Compacted')).toBe(true)
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('Spend says once what the spend is: /cost`s estimate at API list prices, no bill on a subscription, without earlier runs that did not close normally; a fork`s includes its parent`s; nothing said while it is unknown', async ($, on) => {
  const NOTE = 'Claude Code’s /cost estimate at API list prices, not a bill on a subscription; it drops earlier runs that didn’t close normally (a crash, a kill or a shutdown).'
  await demo($, on, state => ({ ...state, session: { ...state.session, isFork: true } }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:inspect')
    await press(ui, 'fold:inspect:spend')
    expect((await ui.find({ key: 'inspect:tile:spend' }))?.text).toBe('≈$4.12At API prices')
    expect((await ui.find({ key: 'inspect:spend' }))?.text).toContain(`${NOTE} As a fork, it includes its parent session’s.`)
    await press(ui, 'fold:inspect:spend')
    await ui.unmount()
  }
})

test('Spend says nothing of the spend while Claude Code has not reported it', async ($, on) => {
  await demo($, on, state => ({ ...state, inspect: { ...state.inspect, costUsd: null } }))
  const ui = await $.ui.mount(pane('terminal'))
  await press(ui, 'tab:inspect')
  await press(ui, 'fold:inspect:spend')
  expect((await ui.find({ key: 'inspect:tile:spend' }))?.text).toBe('—At API prices')
  expect((await ui.find({ key: 'inspect:spend' }))?.text).not.toContain('/cost estimate')
  await ui.unmount()
})

test('a state an earlier build wrote (another session viewed, a recorded sample) holds none of Inspect`s fields: the header draws its line, Inspect its Spend alone, Chat and Recent activity as before', async ($, on) => {
  const older = (state: W.WebStateV2): W.WebStateV2 => {
    const { mode: _mode, ...header } = state.header
    return {
      ...state,
      header: { ...header, line: 'opus-5.5 · context 41% · ≈$4.12' } as W.WebStateV2['header'],
      inspect: { contextPercent: state.inspect.contextPercent, costUsd: state.inspect.costUsd, agents: state.inspect.agents } as W.WebStateV2['inspect'],
      activity: state.activity.map(({ refused: _refused, ...one }) => one),
      chat: state.chat.filter(one => one.kind !== 'compaction'),
    }
  }
  await demo($, on, older)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'deck:header' }))?.text).toContain('opus-5.5 · context 41% · ≈$4.12')
    await press(ui, 'tab:inspect')
    expect((await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => key.startsWith('fold:inspect:'))).toEqual(['fold:inspect:spend'])
    await press(ui, 'fold:inspect:spend')
    expect((await ui.find({ key: 'inspect:tile:spend' }))?.text).toContain('≈$4.12')
    await press(ui, 'fold:inspect:spend')
    await press(ui, 'tab:chat')
    expect(await ui.find({ key: 'chat' })).toBeDefined()
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})
