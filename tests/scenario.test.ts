import type { AgentInfo, On } from 'claude-code'
import { expect, mock, test, type FoundElement } from 'claude-code/testing'

import { bash } from './tools'

/**
 * The QA run's live scenario, replayed through the stubbed engine. You ask
 * the Orchestrator to fix a token refresh bug in /repo, a repository the
 * session's folder is not part of. It hands the hunt to scout, the fix to
 * fixer and the review to reviewer, and fixer hands a README note to a helper
 * of its own. Fixer and helper edit three files, each Edit answering with the
 * tool's own structuredPatch. Reviewer asks fixer over SendMessage, and fixer
 * answers. Each agent completes with an answer. The deck draws it all on the
 * terminal and on the desktop (the v2 pane): the state and your request,
 * the tree of who started whom with the finished folded, each agent's task,
 * result, calls and exact diffs, the whole conversation in Chat, and git's
 * files in Changes.
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
  scroll: { offset: 0, bodyRows: 400 },
  view: {},
} as const

const VIEWPORT = { columns: 100, rows: 400, isFullscreen: true }

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

/**
 * The edits an agent's page shows, each its block's text (keyed `edit:<id>`):
 * its head, and while open its diff, the engine's Code block on the terminal,
 * the deck's numbered rows on a desktop.
 */
async function editsShown(ui: Drawing): Promise<string[]> {
  return (await ui.findAll({ type: 'Box' })).filter(box => (box.key ?? '').startsWith('edit:')).map(box => box.text)
}

/** The Button keys of an agent page's file rows of its edits (`page:edits:<path>`), in the order drawn. */
async function fileRowsOf(ui: Drawing): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => key.startsWith('page:edits:'))
}

/** Now's agent cards, in the order drawn, by the id each stands for. */
async function cardsOf(ui: Drawing): Promise<string[]> {
  return (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('card:') && !key.startsWith('card:open:')).map(key => key.slice('card:'.length))
}

/** An element of a drawing, as found under another. */
type Node = { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }

/** The elements under `el`, itself left out, in document order. */
function nodesUnder(el: { children?: unknown[] }): Node[] {
  const found: Node[] = []
  const walk = (list: unknown[]) => {
    for (const one of list) {
      if (!one || typeof one !== 'object') continue
      found.push(one as Node)
      walk((one as Node).children ?? [])
    }
  }
  walk(el.children ?? [])
  return found
}

/**
 * Who spoke to whom, as Chat's group chat says it, in order: each group's
 * sender (the name its head presses, `chat:from:<key>`; you, for yours at
 * the right) and recipient (the name "to" presses, `chat:to:<key>`; none to
 * you, nor for yours to the Orchestrator), the line over a message stacked
 * under it naming another; a hand-off's line names both ("▸ Orchestrator →
 * scout: …", `chat:handoff:<id>`).
 */
function routesOf(boxes: readonly FoundElement[]): string[] {
  const routes: string[] = []
  for (const box of boxes) {
    const group = box.key ?? ''
    if (!group.startsWith('grp:')) continue
    const nodes = nodesUnder(box)
    const keyOf = (node: Node) => String(node.key ?? node.props?.key ?? '')
    const label = (key: string) => String(nodes.find(node => keyOf(node) === key)?.props?.label ?? '')
    const handoffs = nodes.filter(node => keyOf(node).startsWith('chat:handoff:'))
    if (handoffs.length > 0) {
      for (const one of handoffs) routes.push(String(one.props?.label ?? '').replace(/^[▸▾] /, '').replace(/: [\s\S]*$/, ''))
      continue
    }
    const messages = nodes.filter(node => node.type === 'Box' && /^(msg|send):/.test(keyOf(node)))
    const isMine = messages[0]?.props?.alignItems === 'flex-end'
    const first = group.slice('grp:'.length)
    const from = isMine ? 'You' : label(`chat:from:${first}`)
    let to = label(`chat:to:${first}`) || (isMine ? 'Orchestrator' : 'you')
    for (const message of messages) {
      const key = keyOf(message)
      if (key !== first) {
        const line = nodes.find(node => keyOf(node) === `to:${key}`)
        if (line) to = label(`chat:to:${key}`) || 'you'
      }
      routes.push(`${from} → ${to}`)
    }
  }
  return routes
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
  // its answer to you
  'Orchestrator → you',
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
  await $.tool.call(inLoop('agent-fixer', bash({ command: 'node --test', description: 'Run the unit tests' })))
  await clock.advance(1000)

  // while they work: the state, your request, a card each in the order they started, how each stands; scout done
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const header = await shown(ui, { key: 'deck:header' })
    expect(header.text).toContain('Working')
    expect(header.text).toContain(PROMPT)
    expect(await ui.find({ key: 'needs:now' })).toBeUndefined()
    const cards = await cardsOf(ui)
    expect(cards[0]).toBe('main')
    // scout finished: behind "1 finished ▸" (opened once, it stays so), the rest at work in front
    const fold = await shown(ui, { key: 'finished:now:fold' })
    if (String(fold.props.label).endsWith('▸')) {
      expect([...cards].sort()).toEqual(['agent-fixer', 'agent-helper', 'agent-reviewer', 'main'])
      expect(fold.props.label).toBe('1 finished ▸')
      await ui.press({ key: 'finished:now:fold' })
      await ui.redraw()
    }
    expect([...(await cardsOf(ui))].sort()).toEqual(['agent-fixer', 'agent-helper', 'agent-reviewer', 'agent-scout', 'main'])
    expect((await shown(ui, { key: 'card:agent-fixer' })).text).toContain('fixer')
    expect((await shown(ui, { key: 'card:agent-scout' })).text).toContain('Finished')
    expect((await shown(ui, { key: 'card:agent-scout' })).text).toContain(ANSWERS.scout.slice(0, 20))
    expect((await shown(ui, { key: 'card:agent-helper' })).text).toContain('Started')
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
    // all done: idle, every card done and saying what it handed back
    expect((await shown(ui, { key: 'deck:header' })).text).toContain('Idle')
    expect((await cardsOf(ui)).sort()).toEqual(['agent-fixer', 'agent-helper', 'agent-reviewer', 'agent-scout', 'main'])
    for (const id of ['agent-scout', 'agent-fixer', 'agent-reviewer', 'agent-helper']) expect((await shown(ui, { key: `card:${id}` })).text).toContain('Finished')
    expect((await shown(ui, { key: 'card:agent-fixer' })).text).toContain(ANSWERS.fixer.slice(0, 30))

    // fixer's page: its task, its result, its own patches
    await ui.press({ key: 'agent:agent-fixer' })
    expect((await shown(ui, { key: 'page:task' })).text).toContain(FIXER_TASK)
    expect((await shown(ui, { key: 'page:result' })).text).toContain(ANSWERS.fixer)
    // its Activity and its Edits open, as the web's drawer: its calls newest first, each its tool's chip and its own description
    const activity = (await shown(ui, { key: 'page:activity' })).text
    const at = ['Run the unit tests', 'test/token.test.js', 'src/token.js'].map(words => activity.indexOf(words))
    expect(at.every(one => one >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true)
    // its edits a file a row, the file edited last open on its diff, the other a press away
    const rows = await fileRowsOf(ui)
    expect(rows.length).toBe(2)
    // a line's words, its mark left off: the terminal's block holds it after "+", a desktop's numbered row after its gutter
    const [fix, added, note] = [FIX_LINE, TEST_LINE, NOTE_LINE].map(line => line.slice(1))
    const first = await editsShown(ui)
    expect(first.filter(text => text.includes(fix ?? '') || text.includes(added ?? '')).length).toBe(1)
    await ui.press({ key: rows[1] ?? '' })
    const edits = await editsShown(ui)
    expect(edits.some(text => text.includes(fix ?? ''))).toBe(true)
    expect(edits.some(text => text.includes(added ?? ''))).toBe(true)
    expect(edits.some(text => text.includes(note ?? ''))).toBe(false)
    if (surface === 'terminal') {
      const codes = await ui.findAll({ type: 'Code' })
      expect(codes.filter(code => code.props.format === 'diff').map(code => code.props.path).sort()).toEqual(['src/token.js', 'test/token.test.js'])
    }
    // as it was, for the next surface
    await ui.press({ key: rows[1] ?? '' })
    // helper's own diff is the README note
    await ui.press({ key: 'key:b' })
    await ui.press({ key: 'agent:agent-helper' })
    const notes = await editsShown(ui)
    expect(notes.length).toBe(1)
    expect(notes[0]).toContain(NOTE_LINE.slice(1))
    await ui.press({ key: 'key:b' })

    // Chat: the whole conversation in order, as a group chat; the agents' words to each other among it
    await ui.press({ key: 'tab:chat' })
    const boxes = await ui.findAll({ type: 'Box' })
    expect(routesOf(boxes)).toEqual(ROUTES)
    // the group a sender's head names whom it went to: its words
    const said = (from: string, to: string) =>
      boxes.find(box => {
        const key = (box.key ?? '').slice('grp:'.length)
        const nodes = nodesUnder(box)
        const label = (of: string) => nodes.find(node => (node.key ?? node.props?.key) === of)?.props?.label
        return (box.key ?? '').startsWith('grp:') && label(`chat:from:${key}`) === from && label(`chat:to:${key}`) === to
      })?.text
    expect(said('reviewer', 'fixer')).toContain(ASK)
    expect(said('fixer', 'reviewer')).toContain(REPLY)

    // Changes: the repository the agents edited, its three files and whose own edits touched each
    await ui.press({ key: 'tab:changes' })
    expect((await shown(ui, { key: 'changes:repo' })).text).toContain('repo ⎇ main')
    for (const path of ['src/token.js', 'test/token.test.js', 'README.md']) await shown(ui, { key: `file:${path}` })
    expect((await shown(ui, { key: 'filerow:src/token.js' })).text).toContain('fixer')
    expect((await shown(ui, { key: 'filerow:README.md' })).text).toContain('helper')
    await ui.press({ key: 'file:src/token.js' })
    expect((await ui.findAll({ type: 'Code' })).some(code => code.props.format === 'diff' && code.text.includes(FIX_LINE))).toBe(true)
    await ui.press({ key: 'file:src/token.js' })
    await ui.press({ key: 'tab:now' })
    await ui.unmount()
  }

  // the work is committed: nothing left in Changes
  disk.changed = []
  disk.head = COMMITTED
  await clock.advance(10_000)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'tab:changes' })
    await shown(ui, { type: 'Text', text: /Working tree clean/ })
    await ui.press({ key: 'tab:now' })
    await ui.unmount()
  }
})
