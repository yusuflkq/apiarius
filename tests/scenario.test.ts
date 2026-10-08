import type { AgentInfo, On } from 'claude-code'
import { expect, mock, test, type FoundElement } from 'claude-code/testing'

/**
 * The QA run's live scenario, replayed through the stubbed engine. You ask
 * the Orchestrator to fix a token refresh bug in /repo, a repository the
 * session's folder is not part of. It hands the hunt to scout, the fix to
 * fixer and the review to reviewer, and fixer hands a README note to a helper
 * of its own. Fixer and helper edit three files, each Edit answering with the
 * tool's own structuredPatch. Reviewer asks fixer over SendMessage, and fixer
 * answers. Each agent completes with an answer. The deck draws it all on the
 * terminal and on the desktop: the goal and what needs you, the outline of
 * who started whom with where each is, each agent's task, result and exact
 * diffs, and the whole conversation under the Orchestrator's Talk.
 */

const NOW = 1_700_000_100_000
const BASE = 'a'.repeat(40)
const COMMITTED = 'c'.repeat(40)
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const PANE = {
  title: 'Agent Deck',
  isFocused: true,
  bodyColumns: 96,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

const VIEWPORT = { columns: 100, rows: 50, isFullscreen: true }

const PROMPT = 'Fix the token refresh bug in /repo'
const FIXER_TASK = 'Fix needsRefresh() in src/token.js to refresh SKEW_MS before expiry, add two tests, and tell reviewer when the diff is ready.'
const ASK = 'Is your diff for the token refresh fix ready to review?'
const REPLY = 'The diff is ready: src/token.js and test/token.test.js changed, 4 tests pass.'
const ANSWERS = {
  scout: 'Bug: src/token.js line 12 adds SKEW_MS where it must subtract it.',
  helper: 'Added a Refresh window section to README.md.',
  fixer: 'Fixed needsRefresh() and added two tests; 4 of 4 pass.',
  reviewer: 'The fix is correct and the new tests would have caught the bug.',
} as const
const FIX_LINE = '+  return now >= token.expiresAt - SKEW_MS'
const TEST_LINE = "+test('an expired token needs a refresh', () => {"
const NOTE_LINE = '+## Refresh window'

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

/** What each file's Edit changes, by path in the repository: its hunks as the tool reports them, and git's counts. */
const EDITS: Record<string, { hunks: Hunk[]; added: number; removed: number }> = {
  'src/token.js': {
    hunks: [
      {
        oldStart: 10,
        oldLines: 4,
        newStart: 10,
        newLines: 4,
        lines: [
          ' function needsRefresh(token, now = Date.now()) {',
          "   if (!token || typeof token.expiresAt !== 'number') return true",
          '-  return now > token.expiresAt + SKEW_MS',
          FIX_LINE,
          ' }',
        ],
      },
    ],
    added: 1,
    removed: 1,
  },
  'test/token.test.js': {
    hunks: [
      {
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 7,
        lines: [
          " test('a token far from its expiry does not', () => {",
          "   assert.equal(needsRefresh({ value: 'a', expiresAt: 10 * 60_000 }, 0), false)",
          ' })',
          '+',
          TEST_LINE,
          "+  assert.equal(needsRefresh({ value: 'a', expiresAt: 1_000 }, 2_000), true)",
          '+})',
        ],
      },
    ],
    added: 4,
    removed: 0,
  },
  'README.md': {
    hunks: [
      {
        oldStart: 6,
        oldLines: 1,
        newStart: 6,
        newLines: 4,
        lines: [' Run the tests with `npm test` (or `node --test`).', '+', NOTE_LINE, '+Tokens are refreshed SKEW_MS (60 s) before they expire.'],
      },
    ],
    added: 3,
    removed: 0,
  },
}

/** The repository as git sees it: the files edited since HEAD, and HEAD. */
type Disk = { changed: string[]; head: string }

function unifiedOf(path: string): string {
  const edit = EDITS[path]
  if (!edit) return ''
  const hunks = edit.hunks.flatMap(hunk => [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines])
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...hunks, ''].join('\n')
}

/** What git prints for `argv` run in `cwd`: /repo is a repository, the session's /work is none. */
function gitAt(argv: readonly string[], cwd: string, disk: Disk): { exitCode: number; stdout: string } {
  const line = argv.join(' ')
  const at = cwd.replace(/\\/g, '/')
  if (at !== '/repo' && !at.startsWith('/repo/')) return { exitCode: 128, stdout: '' }
  const ok = (stdout: string) => ({ exitCode: 0, stdout })
  if (line.includes('rev-parse --show-toplevel')) return ok('/repo\n')
  if (line.includes('rev-parse --abbrev-ref HEAD')) return ok('main\n')
  if (line.includes('rev-parse --verify --quiet HEAD')) return ok(`${disk.head}\n`)
  if (line.includes('@{upstream}')) return { exitCode: 128, stdout: '' }
  if (line.includes('status --porcelain')) return ok(disk.changed.map(path => ` M ${path}\0`).join(''))
  if (line.includes('--numstat -z HEAD')) return ok(disk.changed.map(path => `${EDITS[path]?.added ?? 0}\t${EDITS[path]?.removed ?? 0}\t${path}\0`).join(''))
  const diffed = / -U3 HEAD -- (.+)$/.exec(line)?.[1]
  if (diffed !== undefined) return ok(disk.changed.includes(diffed) ? unifiedOf(diffed) : '')
  if (line.includes('rev-list --count')) return ok('1\n')
  if (line.includes(' log --since')) return ok('\x1e\n 1 file changed, 2 insertions(+)\n')
  if (line.includes(' log -n30')) return ok(`\x1e${disk.head}\x1f${disk.head.slice(0, 7)}\x1fSam\x1f1700000000\x1fToken refresh\n\n 3 files changed, 8 insertions(+), 1 deletion(-)\n`)
  return { exitCode: 1, stdout: '' }
}

/**
 * Answers every engine call the deck makes, in Claude Code's place. The
 * agents' list follows the spawns and the turns that end, and git follows
 * the edits: each file an Edit changes shows as modified until `disk` says otherwise.
 */
function world(on: On): { disk: Disk } {
  const disk: Disk = { changed: [], head: BASE }
  const listed = new Map<string, AgentInfo>()
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
  on('agent.list', () => ({ value: [...listed.values()] }))
  on('agent.spawn', ($, e) => {
    const id = `agent-${e.name ?? 'x'}`
    listed.set(id, { id, name: e.name, description: e.description, type: e.subagentType, status: 'running', ...(e.parentAgentId ? { parentId: e.parentAgentId } : {}) })
    return { model: 'claude-haiku', agentId: id }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => {
    const done = e.agentId === undefined ? undefined : listed.get(e.agentId)
    if (done) listed.set(done.id, { ...done, status: 'completed' })
    return { text: '' }
  })
  on('session.send', () => ({ isDelivered: true }))
  on('process.run', ($, e) => ({ value: { ...gitAt(e.argv, e.init?.cwd ?? '', disk), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: NOW, isLink: false } }))
  on('fs.read', () => ({ value: 'hello\nworld\n' }))
  on('tool.call', ($, e) => {
    if (e.tool !== 'Edit') return { result: 'ok' }
    const path = e.file_path.replace(/^\/repo\//, '')
    if (!disk.changed.includes(path)) disk.changed.push(path)
    return {
      result: {
        filePath: e.file_path,
        oldString: e.old_string,
        newString: e.new_string,
        originalFile: '',
        structuredPatch: EDITS[path]?.hunks ?? [],
        userModified: false,
        replaceAll: false,
      },
    }
  })
  return { disk }
}

function pane(surface: Surface) {
  return { plugin: 'agent-deck', surface, component: 'Pane' as const, requestId: 'agent-deck', viewport: VIEWPORT, props: PANE }
}

/** /deck as typed at the prompt, with what the engine stamps on it. */
function deck(args: string) {
  return { command: 'deck', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 100 } }
}

/** An Agent call's spawn, named, with the fields the engine fills in; `parent` is the agent whose loop spawns it (the Orchestrator's when absent). */
function spawn(name: string, type: string, prompt: string, parent?: string) {
  return {
    tool_use_id: `toolu_${name}`,
    prompt,
    description: name,
    subagentType: type,
    name,
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-test',
    background: parent === undefined,
    fork: false,
    ...(parent !== undefined ? { parentAgentId: parent } : {}),
  }
}

/** A tool call made inside agent `agentId`'s loop, as the engine raises it there. */
function inLoop<T extends object>(agentId: string, call: T): T & { agentId: string } {
  return { ...call, agentId }
}

function edit(agentId: string, path: string) {
  return inLoop(agentId, { tool: 'Edit' as const, file_path: `/repo/${path}`, old_string: 'before', new_string: 'after' })
}

/** One agent's SendMessage to another, as the engine raises it from that agent's loop. */
function message(from: string, to: string, text: string) {
  return { to, text, origin: { kind: 'model' as const }, agentId: from }
}

function answer(agentId: string, text: string) {
  return { turnId: `turn-${agentId}`, answer: text, durationMs: 1500, isAborted: false, reason: 'answer' as const, agentId }
}

type Drawing = {
  find: (query: { type?: string; key?: string; text?: string | RegExp }) => Promise<FoundElement | undefined>
  findAll: (query: { type?: string; key?: string; text?: string | RegExp }) => Promise<FoundElement[]>
}

/** The text of the one element `query` finds, or a failure naming what was drawn instead. */
async function shown(ui: Drawing, query: { type?: string; key?: string; text?: string | RegExp }): Promise<FoundElement> {
  const found = await ui.find(query)
  if (found !== undefined) return found
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  throw new Error(`not drawn: ${String(query.text ?? query.key ?? query.type)}; texts: ${JSON.stringify(texts).slice(0, 1500)}`)
}

/** The exact text, as a pattern: `find` matches a plain string anywhere inside a text. */
function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

/** The outline's rows, top to bottom, by the id each stands for. */
async function rowsOf(ui: Drawing): Promise<string[]> {
  return (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('row:')).map(key => key.slice('row:'.length))
}

/** The cells an outline row is indented: its fold column's left padding. */
async function indentOf(ui: Drawing, id: string): Promise<number> {
  const row = (await ui.findAll({ type: 'Box' })).find(box => box.key === `row:${id}`)
  const line = (row?.children[0] ?? {}) as { children?: { props?: Record<string, unknown> }[] }
  return Number(line.children?.[1]?.props?.paddingLeft ?? -1)
}

const ROUTES = [
  'You → Orchestrator',
  'Orchestrator → scout',
  'Orchestrator → fixer',
  'Orchestrator → reviewer',
  'reviewer → fixer',
  'scout → Orchestrator',
  'fixer → helper',
  'helper → fixer',
  'fixer → reviewer',
  'fixer → Orchestrator',
  'reviewer → Orchestrator',
]

test('a live run, replayed: three named agents and a nested helper, their edits, their messages and answers, on each surface', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { disk } = world(on)

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck(''))
  await clock.advance(1000)

  // you ask; the Orchestrator delegates to three named agents
  await $.prompt.submit({ text: PROMPT, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: PROMPT, turnId: 'turn-main' })
  await $.agent.spawn(spawn('scout', 'Explore', 'Find where the token refresh bug is in /repo and report it.'))
  await $.agent.spawn(spawn('fixer', 'general-purpose', FIXER_TASK))
  await $.agent.spawn(spawn('reviewer', 'general-purpose', 'Ask fixer when the diff is ready, wait for the reply, then review it.'))
  await $.session.send(message('agent-reviewer', 'fixer', ASK))
  await $.tool.call(inLoop('agent-scout', { tool: 'Read' as const, file_path: '/repo/src/token.js' }))
  await $.turn.complete(answer('agent-scout', ANSWERS.scout))

  // fixer edits two files and hands the README note to a helper of its own
  await $.tool.call(edit('agent-fixer', 'src/token.js'))
  await $.tool.call(edit('agent-fixer', 'test/token.test.js'))
  await $.agent.spawn(spawn('helper', 'general-purpose', 'Add a Refresh window note to README.md.', 'agent-fixer'))
  await $.tool.call(edit('agent-helper', 'README.md'))
  await $.tool.call(inLoop('agent-fixer', { tool: 'Bash' as const, command: 'node --test', description: 'Run the unit tests' }))
  await clock.advance(1000)

  // while they work: the goal, who runs, who started whom and where each is
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await shown(ui, { type: 'Text', text: exactly('Nothing needs you') })
    await shown(ui, { type: 'Text', text: exactly(PROMPT) })
    expect((await shown(ui, { type: 'Text', text: /3 running/ })).text).toMatch(/1 done · 3 files/)
    expect(await rowsOf(ui)).toEqual(['main', 'agent-scout', 'agent-fixer', 'agent-helper', 'agent-reviewer'])
    expect(await indentOf(ui, 'agent-helper')).toBe(await indentOf(ui, 'agent-fixer') + 2)
    await shown(ui, { type: 'Text', text: exactly('Run the unit tests') })
    await shown(ui, { type: 'Text', text: exactly(`Done: ${ANSWERS.scout}`) })
    await ui.unmount()
  }

  // each one answers; fixer replies to reviewer first
  await $.turn.complete(answer('agent-helper', ANSWERS.helper))
  await $.session.send(message('agent-fixer', 'reviewer', REPLY))
  await $.turn.complete(answer('agent-fixer', ANSWERS.fixer))
  await $.turn.complete(answer('agent-reviewer', ANSWERS.reviewer))
  await $.turn.complete({ turnId: 'turn-main', answer: 'Fixed: needsRefresh() now refreshes before expiry.', durationMs: 90_000, isAborted: false, reason: 'answer' })
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'tab:agents' })
    await ui.press({ key: 'agent:main' })

    // all done: the line says what is left to review, and nobody runs
    await shown(ui, { type: 'Text', text: exactly('All done · 3 files to review') })
    await shown(ui, { key: 'needs:review' })
    expect((await shown(ui, { type: 'Text', text: /4 done/ })).text).not.toMatch(/running/)
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()

    // the outline: every agent under the Orchestrator in spawn order, each with its result; fixer's helper folded under it
    expect(await rowsOf(ui)).toEqual(['main', 'agent-scout', 'agent-fixer', 'agent-reviewer'])
    for (const [name, said] of Object.entries(ANSWERS)) if (name !== 'helper') await shown(ui, { type: 'Text', text: exactly(`Done: ${said}`) })
    await ui.press({ key: 'fold:agent-fixer' })
    expect(await rowsOf(ui)).toEqual(['main', 'agent-scout', 'agent-fixer', 'agent-helper', 'agent-reviewer'])
    expect(await indentOf(ui, 'agent-helper')).toBe(await indentOf(ui, 'agent-fixer') + 2)
    await shown(ui, { type: 'Text', text: exactly(`Done: ${ANSWERS.helper}`) })

    // fixer's row: its task, its result, then Diffs with its own patches
    await ui.press({ key: 'agent:agent-fixer' })
    await ui.press({ key: 'detail:edits' })
    expect((await ui.find({ key: 'agent:agent-fixer' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'agent:main' }))?.props.variant).toBeUndefined()
    for (const label of ['Task', 'Result']) await shown(ui, { type: 'Text', text: exactly(label) })
    await shown(ui, { type: 'Text', text: exactly(FIXER_TASK) })
    await shown(ui, { type: 'Text', text: exactly(ANSWERS.fixer) })
    const codes = await ui.findAll({ type: 'Code' })
    expect(codes.map(code => code.props.format)).toEqual(['diff', 'diff'])
    expect(codes.some(code => code.text.includes(FIX_LINE) && code.props.path === 'src/token.js')).toBe(true)
    expect(codes.some(code => code.text.includes(TEST_LINE) && code.props.path === 'test/token.test.js')).toBe(true)
    expect(codes.some(code => code.text.includes(NOTE_LINE))).toBe(false)
    await shown(ui, { type: 'Text', text: exactly('token.js') })
    await shown(ui, { type: 'Text', text: exactly('token.test.js') })

    // helper's own diff is the README note
    await ui.press({ key: 'agent:agent-helper' })
    const notes = await ui.findAll({ type: 'Code' })
    expect(notes.length).toBe(1)
    expect(notes[0]?.text).toContain(NOTE_LINE)
    await ui.press({ key: 'fold:agent-fixer' })

    // the Orchestrator's Talk is the whole conversation, in order; a press on a row opens its words
    await ui.press({ key: 'agent:main' })
    await ui.press({ key: 'detail:chat' })
    const rows = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('msg:'))
    expect(rows.map(row => row.props.label)).toEqual(ROUTES)
    const keyOf = (route: string) => rows.find(row => row.props.label === route)?.key ?? `missing ${route}`
    await ui.press({ key: keyOf('reviewer → fixer') })
    await shown(ui, { type: 'Markdown', text: ASK })
    await ui.press({ key: keyOf('reviewer → fixer') })
    await ui.press({ key: keyOf('fixer → reviewer') })
    await shown(ui, { type: 'Markdown', text: REPLY })
    await ui.press({ key: keyOf('fixer → reviewer') })
    await ui.press({ key: 'detail:edits' })

    // Changes: the repository the agents edited, its three files and who touched each
    await ui.press({ key: 'tab:changes' })
    await shown(ui, { type: 'Text', text: /repo ⎇ main/ })
    for (const path of ['src/token.js', 'test/token.test.js', 'README.md']) await shown(ui, { key: `file:${path}` })
    expect((await ui.findAll({ type: 'Text', text: exactly('by fixer') })).length).toBe(2)
    expect((await ui.findAll({ type: 'Text', text: exactly('by helper') })).length).toBe(1)
    await ui.press({ key: 'file:src/token.js' })
    const opened = await shown(ui, { type: 'Code' })
    expect(opened.props.format).toBe('diff')
    expect(opened.text).toContain(FIX_LINE)
    await ui.press({ key: 'file:src/token.js' })
    await ui.press({ key: 'tab:agents' })
    await ui.unmount()
  }

  // the work is committed: nothing left to notice
  disk.changed = []
  disk.head = COMMITTED
  await clock.advance(10_000)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await shown(ui, { type: 'Text', text: exactly('Nothing needs you') })
    expect(await ui.find({ key: 'needs:review' })).toBeUndefined()
    await shown(ui, { type: 'Text', text: /no files changed/ })
    await ui.unmount()
  }
})
