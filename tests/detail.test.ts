import type { AgentInfo, On, RenderElement } from 'claude-code'
import { expect, mock, test, type ElementQuery, type FoundElement } from 'claude-code/testing'

import { emptyGit, type GitState } from '../hooks/git'
import * as M from '../hooks/model'
import { treeSize } from '../hooks/ui/common'
import { DETAIL_CHARS, detailBlock, detailVM, isOpen, planStepsOf, toggleOpen } from '../hooks/ui/detail'
import { ROWS, filesSection, filesVM } from '../hooks/ui/files'
import { T } from '../hooks/ui/theme'
import type { Actions, DeckModel, Kit } from '../hooks/ui/types'
import type { DeckAgent, DeckData, DeckEdit, DeckMessage, DeckMessageKind } from '../types'

/**
 * The Agents tab's Files section and detail block, drawn by the test's own
 * Pane instance (PROBE) with each surface's elements, over a deck built here:
 * the Files rows (shared, editing, "N more in Changes"); an agent's detail
 * (task, checklist with the item in hand, result, Diffs, Talk and its field);
 * the Orchestrator's (the whole goal, the whole log); a plan step's; a file's
 * hunks by agent; and the bounds. The engine is the scenario's stub world.
 */

const NOW = 1_700_000_100_000
const MIN = 60_000
const HASH = 'a'.repeat(40)
const PROBE = 'detail-probe'
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

const LONG = 'hooks/ui/some/really/deeply/nested/folder/structure/that/goes/on/and/on/component.tsx'
const TASK =
  "Keep each agent's full todo list and stamp each spawn with the plan step it serves. " +
  'Then make the redraw policy compare plan, todo, edit and message signatures, so nothing redraws without a data change. '.repeat(2)
const RESULT = `Spawns carry their step now.\n\n${'- The plan, todo, edit and message signatures gate every redraw.\n'.repeat(6)}`
const GOAL = 'Make the deck readable: the plan, who does what, and the files.\n\n- show the goal\n- show each agent with its checklist'
const FOLLOW_UP = 'Also flag a file two agents share'
const STEP = 'Build the outline view'
const MODEL_LINE = '+  const stamped = stepOf(call)'
const TYPES_LINE = '+export type Stamp = { step: string }'
const B_LINE = '+  return rows.map(row => row.id)'
const A_LINE = '+  const outline = outlineOf(data)'
const MAIN_LINE = '+Run `npm test` before you commit.'

type Sent = { to: string; text: string }

// The scenario's stub world (tests/scenario.test.ts): fixer fixes src/token.js in /repo, a repository the session's /work is not part of.

const PROMPT = 'Fix the token refresh bug in /repo'
const FIXER_TASK = 'Fix needsRefresh() in src/token.js to refresh SKEW_MS before expiry, add two tests, and tell reviewer when the diff is ready.'
const FIX_LINE = '+  return now >= token.expiresAt - SKEW_MS'

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
}

/** The repository as git sees it: the files edited since HEAD. */
type Disk = { changed: string[] }

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
  if (line.includes('rev-parse --verify --quiet HEAD')) return ok(`${HASH}\n`)
  if (line.includes('@{upstream}')) return { exitCode: 128, stdout: '' }
  if (line.includes('status --porcelain')) return ok(disk.changed.map(path => ` M ${path}\0`).join(''))
  if (line.includes('--numstat -z HEAD')) return ok(disk.changed.map(path => `${EDITS[path]?.added ?? 0}\t${EDITS[path]?.removed ?? 0}\t${path}\0`).join(''))
  const diffed = / -U3 HEAD -- (.+)$/.exec(line)?.[1]
  if (diffed !== undefined) return ok(disk.changed.includes(diffed) ? unifiedOf(diffed) : '')
  if (line.includes('rev-list --count')) return ok('1\n')
  if (line.includes(' log --since')) return ok('\x1e\n 1 file changed, 2 insertions(+)\n')
  if (line.includes(' log -n30')) return ok(`\x1e${HASH}\x1f${HASH.slice(0, 7)}\x1fSam\x1f1700000000\x1fToken refresh\n\n 1 file changed, 1 insertion(+), 1 deletion(-)\n`)
  return { exitCode: 1, stdout: '' }
}

/**
 * The scenario's stub world: every engine call the deck makes, answered in
 * Claude Code's place. The agents' list follows the spawns and the turns that
 * end, git follows the edits, and `sent` records what `session.send` carried.
 */
function world(on: On, sent: Sent[] = []): void {
  const disk: Disk = { changed: [] }
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
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => {
    const done = e.agentId === undefined ? undefined : listed.get(e.agentId)
    if (done) listed.set(done.id, { ...done, status: 'completed' })
    return { text: '' }
  })
  on('session.send', ($, e) => {
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
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
}

function pane(surface: Surface) {
  return { plugin: 'agent-deck', surface, component: 'Pane' as const, requestId: 'agent-deck', viewport: VIEWPORT, props: PANE }
}

/** /deck as typed at the prompt, with what the engine stamps on it. */
function deck(args: string) {
  return { command: 'deck', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 100 } }
}

/** An Agent call's spawn, named, with the fields the engine fills in. */
function spawn(name: string, type: string, prompt: string) {
  return {
    tool_use_id: `toolu_${name}`,
    prompt,
    description: name,
    subagentType: type,
    name,
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-test',
    background: true,
    fork: false,
  }
}

/** A tool call made inside agent `agentId`'s loop, as the engine raises it there. */
function inLoop<T extends object>(agentId: string, call: T): T & { agentId: string } {
  return { ...call, agentId }
}

// The deck, built here.

/** A session half an hour in, the Orchestrator at work. */
function deckData(): DeckData {
  const data = M.emptyData(NOW - 30 * MIN)
  const main = M.agentOf(data, M.MAIN)
  if (main) main.status = 'running'
  return data
}

/** A subagent of the Orchestrator's, labelled at spawn, ten minutes in. */
function agentIn(data: DeckData, id: string, label: string, extra: Partial<DeckAgent> = {}): DeckAgent {
  const made = M.newAgent(id, 'agent', label, NOW - 10 * MIN, { type: 'general-purpose', parentId: M.MAIN, status: 'running', label, description: label, ...extra })
  data.agents.push(made)
  return made
}

/** An exact edit of `path` by `by`, its patch one hunk of `lines`, recorded as the deck records one. */
function editBy(data: DeckData, by: DeckAgent, path: string, lines: readonly string[], at: number): DeckEdit {
  const added = lines.filter(line => line.startsWith('+')).length
  const removed = lines.filter(line => line.startsWith('-')).length
  const made: DeckEdit = {
    id: `edit-${data.edits.length + 1}`,
    agent: by.id,
    tool: 'Edit',
    path,
    abs: `/repo/${path}`,
    at,
    added,
    removed,
    patch: [`@@ -1,${lines.length - added} +1,${lines.length - removed} @@`, ...lines].join('\n'),
    isNew: false,
  }
  M.addEdit(data, by, made)
  return made
}

function say(data: DeckData, from: string, to: string, kind: DeckMessageKind, text: string, at: number): DeckMessage {
  return M.addMessage(data, { from, to, kind, text, at })
}

function gitOf(files: GitState['files'] = []): GitState {
  return { ...emptyGit(), isRepo: true, root: '/repo', branch: 'main', head: HASH, checkedAt: NOW, files, repos: [{ root: '/repo', name: 'repo', lastEditAt: 0, isCwd: true }] }
}

function modelOf(data: DeckData, git: GitState = gitOf()): DeckModel {
  return { data, view: M.defaultView(), git, fileDiff: null, commit: null, chat: null, usage: null, days: [], now: NOW, cwd: '/repo' }
}

/**
 * Actions that note each call, and do to the model what the hooks module
 * does for the ones these pieces press: select, the detail's pane, the tab,
 * a file in Changes, zoom. `sendChat` goes on through the engine's
 * `session.send`, as the hooks module sends to an agent.
 */
function recorder(model: DeckModel, send: (agentId: string, text: string) => Promise<unknown> = async () => undefined): { actions: Actions; calls: string[] } {
  const calls: string[] = []
  const own: Partial<Actions> = {
    select: id => {
      calls.push(`select:${id}`)
      model.view.agent = id
    },
    setAgentPane: pane => {
      calls.push(`setAgentPane:${pane}`)
      model.view.agentPane = pane
    },
    setTab: tab => {
      calls.push(`setTab:${tab}`)
      model.view.tab = tab
    },
    selectFile: path => {
      calls.push(`selectFile:${path}`)
      model.view.file = model.view.file === path ? '' : path
    },
    zoomTo: id => {
      calls.push(`zoomTo:${id}`)
      model.view.zoom = id
    },
    sendChat: (agentId, text) => {
      calls.push(`sendChat:${agentId}:${text}`)
      void send(agentId, text)
    },
  }
  const actions = new Proxy(own, {
    get: (target, name) =>
      (target as Record<string | symbol, unknown>)[name] ??
      ((...args: unknown[]) => {
        calls.push([String(name), ...args.map(String)].join(':'))
      }),
  }) as Actions
  return { actions, calls }
}

/** Draws `draw`'s tree as the deck's pane would, under the PROBE instance, with the surface's own elements. */
function probe(on: On, draw: (kit: Kit) => RenderElement): void {
  on('ui.render', { component: 'Pane', requestId: PROBE }, ($, e) => {
    const ui = $.ui.resolve(e)
    const kit: Kit = {
      surface: e.surface,
      Box: ui.Box,
      Text: ui.Text,
      Button: ui.Button,
      Code: ui.Code,
      Markdown: ui.Markdown,
      columns: Math.max(24, e.props.bodyColumns - 1),
      ...('Input' in ui ? { Input: ui.Input } : {}),
      ...('Select' in ui ? { Select: ui.Select } : {}),
    }
    return draw(kit)
  })
}

function mountOn(surface: Surface) {
  return { plugin: 'agent-deck', surface, component: 'Pane' as const, requestId: PROBE, viewport: VIEWPORT, props: PANE }
}

type Drawing = {
  find: (query: ElementQuery) => Promise<FoundElement | undefined>
  findAll: (query: ElementQuery) => Promise<FoundElement[]>
}

/** Whether a found element holds only strings: for a Text, one run of text as drawn, not a Text around others. */
function isLeaf(one: FoundElement): boolean {
  return one.children.every(child => typeof child === 'string')
}

/** The Text leaves whose text matches: an outer Text's text is its inner ones' together, so it would match as well. */
async function leaves(ui: Drawing, text: string | RegExp): Promise<FoundElement[]> {
  return (await ui.findAll({ type: 'Text', text })).filter(isLeaf)
}

/** The element `query` finds (for Text, the innermost that matches), or a failure naming it and what was drawn instead. */
async function shown(ui: Drawing, query: ElementQuery): Promise<FoundElement> {
  const found = query.type === 'Text' ? ((await ui.findAll(query)).find(isLeaf) ?? (await ui.find(query))) : await ui.find(query)
  if (found !== undefined) return found
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  const keys = (await ui.findAll({ type: 'Button' })).map(one => one.key)
  throw new Error(`not drawn: ${String(query.text ?? '')} ${query.key ?? ''} ${query.type ?? ''}; texts: ${JSON.stringify(texts).slice(0, 2000)}; buttons: ${JSON.stringify(keys).slice(0, 800)}`)
}

/** The exact text, as a pattern: `find` matches a plain string anywhere inside a text. */
function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

async function buttonKeys(ui: Drawing, prefix: string): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => key.startsWith(prefix))
}

/** The Boxes that carry the copper rail: the host's `quote` border in copper. */
async function rails(ui: Drawing): Promise<FoundElement[]> {
  return (await ui.findAll({ type: 'Box' })).filter(box => box.props.borderStyle === 'quote' && box.props.borderColor === T.copper)
}

type Child = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** The widths of the columns of the file row whose path Button is keyed `key` ('flex' for the one that grows). */
async function columnsOfFile(ui: Drawing, key: string): Promise<(number | string)[]> {
  const holds = (node: unknown): boolean => {
    const one = node as Child
    return (one.props?.key === key && one.type === 'Button') || (one.children ?? []).some(holds)
  }
  const boxes = (await ui.findAll({ type: 'Box' })).filter(box => box.props.flexDirection === 'row' && box.children.some(child => (child as Child).props?.width !== undefined && holds(child)))
  const line = boxes[boxes.length - 1]
  return ((line?.children ?? []) as Child[]).map(child => (typeof child.props?.width === 'number' ? child.props.width : child.props?.flexGrow ? 'flex' : '?'))
}

// Files.

test('Files: while agents work, the files in work (editing, shared) and "N more in Changes"; once none works, the files edited last', async ($, on) => {
  mock.clock(on, { now: NOW })
  const data = deckData()
  const a = agentIn(data, 'agent-a', 'Phase A')
  const b = agentIn(data, 'agent-b', 'Phase B')
  const c = agentIn(data, 'agent-c', 'Phase C', { status: 'completed', endedAt: NOW - MIN })
  const d = agentIn(data, 'agent-d', 'scout', { status: 'completed', endedAt: NOW - 6 * MIN })
  editBy(data, c, 'docs/one.md', ['+one'], NOW - 9 * MIN)
  editBy(data, c, 'docs/two.md', ['+two'], NOW - 8 * MIN)
  editBy(data, d, 'docs/three.md', ['+three'], NOW - 7 * MIN)
  editBy(data, d, 'docs/four.md', ['+four'], NOW - 7 * MIN)
  editBy(data, b, 'hooks/ui/agents.tsx', ['-old', '+new'], NOW - 6 * MIN)
  editBy(data, a, 'hooks/ui/agents.tsx', ['+more'], NOW - 5 * MIN)
  editBy(data, a, 'hooks/model.ts', ['+a', '+b', '-c'], NOW - 4 * MIN)
  editBy(data, b, LONG, ['+x'], NOW - 3 * MIN)
  editBy(data, c, 'docs/five.md', ['+five'], NOW - 2 * MIN)
  const model = modelOf(data)
  const { actions, calls } = recorder(model)
  probe(on, kit => filesSection(kit, filesVM(model.data, model.git, model.now, model.view.agent), actions))
  world(on)

  for (const surface of SURFACES) {
    model.view.agent = ''
    const ui = await $.ui.mount(mountOn(surface))

    // eight files, two agents at work: the file each has in hand and the one both share, in the order they were first edited
    const rows = (await buttonKeys(ui, 'files:')).filter(key => key !== 'files:more')
    expect(rows).toEqual(['files:hooks/ui/agents.tsx', 'files:hooks/model.ts', `files:${LONG}`])
    await shown(ui, { type: 'Text', text: exactly('Files') })
    await shown(ui, { type: 'Text', text: exactly('  8 changed ·') })
    expect((await shown(ui, { key: 'files:more' })).props.label).toBe('5 more in Changes')

    // who, in spawn order: two live agents on agents.tsx share it; each running agent's last file is "editing"
    await shown(ui, { type: 'Text', text: exactly('Phase A + B · shared') })
    await shown(ui, { type: 'Text', text: exactly('Phase A · editing') })
    await shown(ui, { type: 'Text', text: exactly('Phase B · editing') })
    const shared = await leaves(ui, exactly(' · shared'))
    expect(shared.length).toBe(1)
    expect(shared[0]?.props.color).toBe(T.warn)
    expect((await leaves(ui, exactly(' · editing'))).length).toBe(2)
    expect(await ui.find({ type: 'Text', text: /scout/ })).toBeUndefined()

    // a square where a live agent is on the file
    const squares = await leaves(ui, exactly('■'))
    expect(squares.length).toBe(3)
    expect(squares.every(one => one.props.color === T.ok)).toBe(true)
    expect((await shown(ui, { key: 'files:hooks/model.ts' })).props.dimColor).toBe(false)

    // a long path is cut from its start: the file name stays
    const long = String((await shown(ui, { key: `files:${LONG}` })).props.label)
    expect(long.startsWith('…')).toBe(true)
    expect(long.endsWith('/component.tsx')).toBe(true)
    expect(Array.from(long).length).toBeLessThan(LONG.length)

    // +a −r right after the path's fixed column, in sage and oxide, then the editors
    const plus = await leaves(ui, exactly('+2'))
    expect(plus.length).toBe(2)
    expect(plus.every(one => one.props.color === T.ok)).toBe(true)
    expect((await shown(ui, { type: 'Text', text: exactly('−1') })).props.color).toBe(T.err)
    expect(await columnsOfFile(ui, 'files:hooks/model.ts')).toEqual([2, 28, 12, 'flex'])

    // a press selects the file; its row then carries the copper rail
    expect(await rails(ui)).toEqual([])
    await ui.press({ plugin: 'test', key: 'files:hooks/model.ts' })
    expect(calls).toContain('select:file:hooks/model.ts')
    await ui.redraw()
    const railed = await rails(ui)
    expect(railed.length).toBe(1)
    expect(railed[0]?.text).toContain('model.ts')
    expect(await ui.find({ type: 'Text', text: exactly('▌') })).toBeUndefined()

    // a selected file outside the ones in work still shows
    model.view.agent = 'file:docs/one.md'
    await ui.redraw()
    expect(await buttonKeys(ui, 'files:docs/one.md')).toEqual(['files:docs/one.md'])
    expect((await shown(ui, { key: 'files:more' })).props.label).toBe('4 more in Changes')

    // "N more in Changes" opens the Changes tab
    await ui.press({ plugin: 'test', key: 'files:more' })
    expect(calls).toContain('setTab:changes')
    await ui.unmount()
  }

  // nobody at work: the six files edited last, for review, their paths dim
  for (const agent of [a, b]) Object.assign(agent, { status: 'completed', endedAt: NOW - 30_000 })
  for (const surface of SURFACES) {
    model.view.agent = ''
    const ui = await $.ui.mount(mountOn(surface))
    const rows = (await buttonKeys(ui, 'files:')).filter(key => key !== 'files:more')
    expect(rows.length).toBe(ROWS)
    expect(rows).toEqual(['files:docs/three.md', 'files:docs/four.md', 'files:hooks/ui/agents.tsx', 'files:hooks/model.ts', `files:${LONG}`, 'files:docs/five.md'])
    expect((await shown(ui, { key: 'files:docs/three.md' })).props.dimColor).toBe(true)
    expect(await ui.find({ type: 'Text', text: /editing|shared/ })).toBeUndefined()
    expect((await shown(ui, { key: 'files:more' })).props.label).toBe('2 more in Changes')
    await ui.unmount()
  }

  // nothing edited yet: no section at all
  model.data = deckData()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(mountOn(surface))
    expect(await buttonKeys(ui, 'files:')).toEqual([])
    expect(await ui.find({ type: 'Text', text: /Files|changed/ })).toBeUndefined()
    await ui.unmount()
  }
})

// An agent.

/** Phase A at work: a long task, a checklist with one item in hand and a call in flight, two files edited, three messages. */
function phaseA(): { data: DeckData; a: DeckAgent; question: DeckMessage } {
  const data = deckData()
  const a = agentIn(data, 'agent-a', 'Phase A', {
    scope: 'data, banner, redraw policy',
    description: 'Phase A: data, banner, redraw policy',
    prompt: TASK,
    todos: [
      { key: 'read', text: 'Read the model', status: 'done' },
      { key: 'tests', text: 'Write the tests', status: 'done' },
      { key: 'stamp', text: 'Stamping spawns with their step', status: 'active' },
      { key: 'docs', text: 'Update the docs', status: 'pending' },
    ],
  })
  const b = agentIn(data, 'agent-b', 'Phase B')
  const call = { id: 'toolu-edit', tool: 'Edit', target: 'hooks/model.ts', at: NOW - 20_000 }
  a.current = call
  a.recent = [{ id: 'toolu-read', tool: 'Read', target: 'hooks/model.ts', at: NOW - 60_000, ms: 1200, ok: true }, call]
  a.tools = 2
  editBy(data, a, 'hooks/model.ts', [' const call = next()', MODEL_LINE], NOW - 5 * MIN)
  editBy(data, a, 'hooks/types.ts', [TYPES_LINE], NOW - 4 * MIN)
  say(data, M.MAIN, a.id, 'spawn', TASK, NOW - 10 * MIN)
  say(data, M.MAIN, b.id, 'spawn', 'Build the native outline.', NOW - 9 * MIN)
  const question = say(data, b.id, a.id, 'message', 'Is the stamp ready for Phase B?', NOW - 3 * MIN)
  say(data, a.id, b.id, 'message', 'Yes: spawns carry their step now.', NOW - 2 * MIN)
  return { data, a, question }
}

test("an agent's detail: header, task with more, checklist with the live call, Diffs, Talk and its field, Tool calls, then its result", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const sent: Sent[] = []
  const { data, a, question } = phaseA()
  const model = modelOf(data)
  const { actions, calls } = recorder(model, (agentId, text) => $.session.send({ to: agentId, text, origin: { kind: 'plugin', name: 'agent-deck' } }))
  probe(on, kit => detailBlock(kit, detailVM(model.data, model.view, model.git, model.chat, model.fileDiff, model.now), actions))
  world(on, sent)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  for (const surface of SURFACES) {
    a.status = 'running'
    delete a.endedAt
    delete a.answer
    model.view.agent = 'agent-a'
    model.view.agentPane = 'edits'
    const ui = await $.ui.mount(mountOn(surface))

    // the header behind the copper rail (the host's border, no glyph): the square, the label and its scope; Zoom (z), minutes, +a −r
    const railed = await rails(ui)
    expect(railed.length).toBe(1)
    expect(railed[0]?.text).toContain('Phase A')
    expect(await ui.find({ type: 'Text', text: exactly('▌') })).toBeUndefined()
    expect((await shown(ui, { type: 'Text', text: exactly('Phase A') })).props.bold).toBe(true)
    await shown(ui, { type: 'Text', text: exactly('  data, banner, redraw policy') })
    expect((await shown(ui, { key: 'detail:zoom' })).props).toMatchObject({ label: 'Zoom', hotkey: 'z' })
    // nothing under it in the outline: nothing to fold
    expect(await ui.find({ key: 'detail:fold' })).toBeUndefined()
    await shown(ui, { type: 'Text', text: exactly('10m') })
    expect((await shown(ui, { type: 'Text', text: exactly('+2') })).props.color).toBe(T.ok)
    await ui.press({ plugin: 'test', key: 'detail:zoom' })
    expect(calls).toContain('zoomTo:agent-a')
    await ui.redraw()
    expect((await shown(ui, { key: 'detail:zoom' })).props.label).toBe('Unzoom')
    await ui.press({ plugin: 'test', key: 'detail:zoom' })
    expect(calls).toContain('zoomTo:')
    await ui.redraw()

    // the task: two lines' worth, then "more" opens the whole of it
    await shown(ui, { type: 'Text', text: exactly('Task') })
    const short = await shown(ui, { type: 'Text', text: /^Keep each agent's full todo list/ })
    expect(short.text.endsWith('…')).toBe(true)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect((await shown(ui, { key: 'more:task:agent-a' })).props.label).toBe('more')
    await ui.press({ plugin: 'test', key: 'more:task:agent-a' })
    await ui.redraw()
    expect((await shown(ui, { type: 'Markdown' })).props.text).toBe(TASK.trim())
    expect((await shown(ui, { key: 'more:task:agent-a' })).props.label).toBe('less')
    await ui.press({ plugin: 'test', key: 'more:task:agent-a' })
    await ui.redraw()
    expect(isOpen('task:agent-a')).toBe(false)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()

    // the checklist: ✓ done, ■ the item in hand (bold, the live call beside it), □ to do
    await shown(ui, { type: 'Text', text: exactly('Todo') })
    expect((await leaves(ui, exactly('✓'))).length).toBe(2)
    expect((await shown(ui, { type: 'Text', text: exactly('Read the model') })).props.dimColor).toBe(true)
    const current = await shown(ui, { type: 'Text', text: exactly('Stamping spawns with their step') })
    expect(current.props.bold).toBe(true)
    const live = await shown(ui, { type: 'Text', text: /^ {2}.*model\.ts/ })
    expect(live.props.dimColor).toBe(true)
    expect((await shown(ui, { type: 'Text', text: exactly('□') })).props.color).toBe(T.text3)
    await shown(ui, { type: 'Text', text: exactly('Update the docs') })
    expect(await ui.find({ type: 'Text', text: exactly('Result') })).toBeUndefined()

    // the switch: Diffs (open), Talk 3, Tool calls 2
    expect((await shown(ui, { key: 'detail:edits' })).props.label).toBe('Diffs')
    expect((await shown(ui, { key: 'detail:edits' })).props.dimColor).toBe(false)
    expect((await shown(ui, { key: 'detail:chat' })).props.label).toBe('Talk 3')
    expect((await shown(ui, { key: 'detail:activity' })).props.label).toBe('Tool calls 2')

    // Diffs: its exact patches, one header and one diff block per file, in the order they were first edited
    const codes = await ui.findAll({ type: 'Code' })
    expect(codes.map(code => [code.props.format, code.props.path])).toEqual([
      ['diff', 'hooks/model.ts'],
      ['diff', 'hooks/types.ts'],
    ])
    expect(String(codes[0]?.props.source)).toContain(MODEL_LINE)
    expect(String(codes[1]?.props.source)).toContain(TYPES_LINE)
    expect(codes.every(code => String(code.props.source).length <= 10_000)).toBe(true)
    expect((await shown(ui, { type: 'Text', text: exactly('model.ts') })).props.bold).toBe(true)
    await shown(ui, { type: 'Text', text: exactly('hooks/') })

    // Talk: every message to and from it, a press opening one in full; the field sends through session.send
    await ui.press({ plugin: 'test', key: 'detail:chat' })
    expect(calls).toContain('setAgentPane:chat')
    await ui.redraw()
    const routes = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('msg:'))
    expect(routes.map(route => route.props.label)).toEqual(['Orchestrator → Phase A', 'Phase B → Phase A', 'Phase A → Phase B'])
    // two lines a message: who to whom and the time, then its first line under it, dim; no tag column
    for (const tag of ['task', 'msg', 'ask', 'result']) expect(await ui.find({ type: 'Text', text: exactly(tag) })).toBeUndefined()
    expect((await shown(ui, { type: 'Text', text: exactly('Is the stamp ready for Phase B?') })).props.dimColor).toBe(true)
    expect((await leaves(ui, /^\d\d:\d\d$/)).length).toBe(3)
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.press({ plugin: 'test', key: `msg:${question.id}` })
    await ui.redraw()
    expect((await shown(ui, { type: 'Markdown' })).props.text).toBe('Is the stamp ready for Phase B?')
    expect((await shown(ui, { key: `msg:${question.id}` })).props.dimColor).toBe(false)
    expect(await ui.find({ type: 'Text', text: exactly('Is the stamp ready for Phase B?') })).toBeUndefined()
    await ui.press({ plugin: 'test', key: `msg:${question.id}` })
    await ui.redraw()
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    const field = await shown(ui, { key: 'chat:agent-a' })
    expect(field.type).toBe('Input')
    expect(field.props.label).toBe('To Phase A')
    await ui.input({ plugin: 'test', key: 'chat:agent-a', text: `  hello from ${surface}  ` })
    await clock.settle()
    expect(calls).toContain(`sendChat:agent-a:hello from ${surface}`)
    await shown(ui, { type: 'Text', text: /through SendMessage/ })

    // Tool calls: the recent calls, the one in flight running
    await ui.press({ plugin: 'test', key: 'detail:activity' })
    await ui.redraw()
    await shown(ui, { type: 'Text', text: exactly('2 calls') })
    await shown(ui, { type: 'Text', text: exactly('Edit') })
    await shown(ui, { type: 'Text', text: exactly('running') })
    await shown(ui, { type: 'Text', text: exactly('1s') })

    // done: its result, two lines then "more" for the whole as Markdown; the item in hand ticked, no live call
    a.status = 'completed'
    a.endedAt = NOW - MIN
    a.answer = RESULT
    delete a.current
    await ui.press({ plugin: 'test', key: 'detail:edits' })
    await ui.redraw()
    await shown(ui, { type: 'Text', text: exactly('Result') })
    await shown(ui, { type: 'Text', text: /^Spawns carry their step now\./ })
    await shown(ui, { type: 'Text', text: exactly('9m') })
    expect((await leaves(ui, exactly('✓'))).length).toBe(3)
    expect(await ui.find({ type: 'Text', text: /^ {2}.*model\.ts/ })).toBeUndefined()
    await ui.press({ plugin: 'test', key: 'more:result:agent-a' })
    await ui.redraw()
    expect((await shown(ui, { type: 'Markdown' })).props.text).toBe(RESULT.trim())
    toggleOpen('result:agent-a')
    await ui.unmount()
  }

  expect(sent).toEqual([
    { to: 'agent-a', text: 'hello from terminal' },
    { to: 'agent-a', text: 'hello from desktop' },
  ])
})

test('an agent that waits on you says on what, in ochre, and where to answer; one held on its own work does not; one with nothing yet says so', async ($, on) => {
  mock.clock(on, { now: NOW })
  const data = deckData()
  const blocked = agentIn(data, 'agent-w', 'tester', { prompt: 'Run the tests.' })
  const quiet = agentIn(data, 'agent-q', 'quiet one', { prompt: 'Look around.' })
  const held = agentIn(data, 'agent-h', 'holder', { prompt: 'Start the build and watch it.', status: 'waiting' })
  const call = { id: 'toolu-bash', tool: 'Bash', target: 'Run the tests', description: 'Run the tests', command: 'npm test', at: NOW - 20_000 }
  blocked.current = call
  blocked.recent = [call]
  blocked.tools = 1
  const main = M.agentOf(data, M.MAIN)
  if (main) main.needs = { text: 'Claude needs your permission to use Bash', kind: 'permission_prompt', at: NOW - 15_000, agent: blocked.id, call: call.id }
  const model = modelOf(data)
  const { actions } = recorder(model)
  probe(on, kit => detailBlock(kit, detailVM(model.data, model.view, model.git, model.chat, model.fileDiff, model.now), actions))
  world(on)

  for (const surface of SURFACES) {
    model.view.agent = blocked.id
    model.view.agentPane = 'edits'
    const blockedUi = await $.ui.mount(mountOn(surface))
    expect((await shown(blockedUi, { type: 'Text', text: exactly('Waits on you: allow Bash "npm test"') })).props.color).toBe(T.warn)
    expect((await shown(blockedUi, { type: 'Text', text: exactly('■') })).props.color).toBe(T.warn)
    // and where to answer it
    expect((await shown(blockedUi, { type: 'Text', text: exactly('Answer the prompt in the conversation.') })).props.dimColor).toBe(true)
    await blockedUi.unmount()

    // one the engine lists as waiting with no prompt for you is busy on its own work: no ochre, no "Waits on you"
    model.view.agent = held.id
    const heldUi = await $.ui.mount(mountOn(surface))
    expect(await heldUi.find({ type: 'Text', text: /Waits on you/ })).toBeUndefined()
    expect((await shown(heldUi, { type: 'Text', text: exactly('Waiting on background work') })).props.color).toBeUndefined()
    expect((await shown(heldUi, { type: 'Text', text: exactly('■') })).props.color).toBe(T.ok)
    await heldUi.unmount()

    model.view.agent = quiet.id
    const ui = await $.ui.mount(mountOn(surface))
    expect(await ui.find({ type: 'Text', text: /^Waits on you/ })).toBeUndefined()
    expect(await ui.find({ key: 'more:task:agent-q' })).toBeUndefined()
    await shown(ui, { type: 'Text', text: exactly('Look around.') })
    await shown(ui, { type: 'Text', text: exactly('No edits by quiet one yet.') })
    model.view.agentPane = 'activity'
    await ui.redraw()
    await shown(ui, { type: 'Text', text: exactly('No tool calls by quiet one yet.') })
    model.view.agentPane = 'chat'
    await ui.redraw()
    await shown(ui, { type: 'Text', text: /^No messages with quiet one yet\./ })
    await ui.unmount()
  }
})

// The Orchestrator.

test("the Orchestrator's detail: the goal only when the header cut it, its follow-ups, Talk (the whole log) first, then its own edits", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const sent: Sent[] = []
  const { data, a } = phaseA()
  data.goals = [{ id: 'goal-1', headline: 'Make the deck readable', text: GOAL, at: NOW - 20 * MIN, followUps: [{ text: FOLLOW_UP, at: NOW - 15 * MIN }], origin: 'composer' }]
  const main = M.agentOf(data, M.MAIN)
  if (!main) throw new Error('no Orchestrator')
  editBy(data, main, 'README.md', [MAIN_LINE], NOW - 6 * MIN)
  say(data, M.YOU, M.MAIN, 'prompt', GOAL, NOW - 20 * MIN)
  for (let i = 0; i < 36; i++) say(data, i % 2 === 0 ? a.id : M.MAIN, i % 2 === 0 ? M.MAIN : a.id, 'message', `Round ${i + 1} of the hand-off`, NOW - MIN + i)
  const all = data.messages.length
  const model = modelOf(data)
  const { actions, calls } = recorder(model)
  probe(on, kit => detailBlock(kit, detailVM(model.data, model.view, model.git, model.chat, model.fileDiff, model.now), actions))
  world(on, sent)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  for (const surface of SURFACES) {
    model.view.agent = M.MAIN
    model.view.agentPane = 'edits'
    data.goals[0] = { ...data.goals[0]!, text: GOAL }
    const ui = await $.ui.mount(mountOn(surface))

    // its header and its follow-up; the goal the header shows whole, and the plan the outline shows, are not repeated
    expect((await shown(ui, { type: 'Text', text: exactly('Orchestrator') })).props.bold).toBe(true)
    await shown(ui, { type: 'Text', text: exactly('  waiting on 2 agents') })
    expect(await ui.find({ key: 'detail:zoom' })).toBeUndefined()
    await shown(ui, { type: 'Text', text: exactly('Then') })
    await shown(ui, { type: 'Text', text: exactly(FOLLOW_UP) })
    for (const text of ['Goal', 'Plan']) expect(await ui.find({ type: 'Text', text: exactly(text) })).toBeUndefined()
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()

    // Talk first, whatever the agents' pane: the whole message log, every row, and the field for your next prompt
    expect((await shown(ui, { key: 'detail:chat' })).props).toMatchObject({ label: `Talk ${all}`, dimColor: false })
    expect((await shown(ui, { key: 'detail:edits' })).props.dimColor).toBe(true)
    const rows = await buttonKeys(ui, 'msg:')
    expect(rows.length).toBe(all)
    expect(await ui.find({ type: 'Text', text: /earlier$/ })).toBeUndefined()
    const labels = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('msg:')).map(button => button.props.label)
    expect(labels.slice(0, 4)).toEqual(['Orchestrator → Phase A', 'Orchestrator → Phase B', 'Phase B → Phase A', 'Phase A → Phase B'])
    expect(labels).toContain('You → Orchestrator')
    expect(await ui.find({ type: 'Text', text: exactly('Round 36 of the hand-off') })).toBeDefined()
    const field = await shown(ui, { key: 'chat:main' })
    expect(field.props.placeholder).toBe('Your next prompt for the Orchestrator…')
    await ui.input({ plugin: 'test', key: 'chat:main', text: 'Ship it' })
    await clock.settle()
    expect(calls).toContain('sendChat:main:Ship it')

    // Diffs: its own edits only; the pick is the Orchestrator's own, the agents' pane stays as it was
    await ui.press({ plugin: 'test', key: 'detail:edits' })
    await ui.redraw()
    const codes = await ui.findAll({ type: 'Code' })
    expect(codes.length).toBe(1)
    expect(String(codes[0]?.props.source)).toContain(MAIN_LINE)
    expect(codes[0]?.props.path).toBe('README.md')
    model.view.agentPane = 'chat'
    await ui.redraw()
    expect(await ui.findAll({ type: 'Code' })).toHaveLength(1)
    await ui.press({ plugin: 'test', key: 'detail:chat' })
    await ui.redraw()
    expect(model.view.agentPane).toBe('chat')
    expect(await ui.find({ type: 'Code' })).toBeUndefined()

    // a goal longer than the header's two lines: the whole of it here, as Markdown
    data.goals[0] = { ...data.goals[0]!, text: `${GOAL}\n\n${'- one more thing the deck must do\n'.repeat(8)}` }
    await ui.redraw()
    await shown(ui, { type: 'Text', text: exactly('Goal') })
    expect(String((await shown(ui, { type: 'Markdown' })).props.text)).toContain('one more thing the deck must do')
    await ui.unmount()
  }
})

// A plan step.

test("a plan step's detail: its status and the files its agents changed in the Files section's columns; its agents are the outline's rows", async ($, on) => {
  mock.clock(on, { now: NOW })
  const { data, a } = phaseA()
  const main = M.agentOf(data, M.MAIN)
  if (!main) throw new Error('no Orchestrator')
  main.todos = [
    { key: 'read', text: 'Read the deck', status: 'done' },
    { key: 'build', text: STEP, status: 'active' },
    { key: 'review', text: 'Review and test', status: 'pending' },
  ]
  a.during = { kind: 'todo', key: 'build', text: STEP }
  const helper = agentIn(data, 'agent-h', 'helper', { parentId: a.id })
  editBy(data, helper, 'README.md', ['+A note on stamps.'], NOW - MIN)
  const step = planStepsOf(data).find(one => one.agents.includes(a.id))
  if (!step) throw new Error(`no plan step holds ${a.id}: ${JSON.stringify(planStepsOf(data))}`)
  const model = modelOf(data)
  const { actions, calls } = recorder(model)
  probe(on, kit => detailBlock(kit, detailVM(model.data, model.view, model.git, model.chat, model.fileDiff, model.now), actions))
  world(on)

  for (const surface of SURFACES) {
    model.view.agent = step.key
    const ui = await $.ui.mount(mountOn(surface))
    expect((await shown(ui, { type: 'Text', text: exactly(step.text) })).props.bold).toBe(true)
    expect((await shown(ui, { type: 'Text', text: exactly('■') })).props.color).toBe(T.ok)
    await shown(ui, { type: 'Text', text: exactly('Status') })
    await shown(ui, { type: 'Text', text: exactly('In progress') })
    expect((await shown(ui, { key: 'detail:fold' })).props).toMatchObject({ label: 'Fold', hotkey: 'f' })
    // no agent rows: the outline shows them under the step
    expect(await buttonKeys(ui, 'detail:agent:')).toEqual([])
    expect(await ui.find({ type: 'Text', text: exactly('Agents') })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: exactly('Stamping spawns with their step') })).toBeUndefined()
    // the files all of its agents changed, the helper's too, each row in the Files section's columns, editors after +a −r
    await shown(ui, { type: 'Text', text: exactly('Files') })
    expect(await buttonKeys(ui, 'detail:file:')).toEqual(['detail:file:hooks/model.ts', 'detail:file:hooks/types.ts', 'detail:file:README.md'])
    expect(await columnsOfFile(ui, 'detail:file:README.md')).toEqual([2, 28, 12, 'flex'])
    await shown(ui, { type: 'Text', text: exactly('helper') })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()

    await ui.press({ plugin: 'test', key: 'detail:zoom' })
    expect(calls).toContain(`zoomTo:${step.key}`)
    model.view.zoom = ''
    await ui.press({ plugin: 'test', key: 'detail:fold' })
    expect(calls).toContain(`toggleFold:${step.key}`)
    await ui.press({ plugin: 'test', key: 'detail:file:hooks/types.ts' })
    expect(calls).toContain('select:file:hooks/types.ts')
    await ui.unmount()
  }

  // a step gone from the plan says so in a sentence
  model.view.agent = 'step:gone'
  const ui = await $.ui.mount(mountOn('terminal'))
  await shown(ui, { type: 'Text', text: exactly('That step is no longer in the plan. Pick another row of the outline.') })
  await ui.unmount()

  // an implicit plan (each Agent call a step) is no plan the detail reads
  delete main.todos
  for (const agent of data.agents) delete agent.during
  expect(planStepsOf(data)).toEqual([])
})

// A file.

test("a file's detail: its hunks grouped by the agent that made them, two live agents flagged, and Open in Changes", async ($, on) => {
  mock.clock(on, { now: NOW })
  const data = deckData()
  const a = agentIn(data, 'agent-a', 'Phase A')
  const b = agentIn(data, 'agent-b', 'Phase B')
  editBy(data, b, 'hooks/ui/agents.tsx', [' export function rows() {', B_LINE, '-  return []'], NOW - 6 * MIN)
  editBy(data, a, 'hooks/ui/agents.tsx', [A_LINE], NOW - 5 * MIN)
  editBy(data, a, 'hooks/model.ts', ['+elsewhere'], NOW - 4 * MIN)
  const model = modelOf(data, gitOf([{ path: 'hooks/ui/agents.tsx', code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 2, removed: 1 }]))
  const { actions, calls } = recorder(model)
  probe(on, kit => detailBlock(kit, detailVM(model.data, model.view, model.git, model.chat, model.fileDiff, model.now), actions))
  world(on)

  for (const surface of SURFACES) {
    model.view.agent = 'file:hooks/ui/agents.tsx'
    model.view.file = ''
    model.view.tab = 'agents'
    const ui = await $.ui.mount(mountOn(surface))

    // the header: its directory dim, its name bold, the square of the live agents on it, its +a −r
    expect((await shown(ui, { type: 'Text', text: exactly('agents.tsx') })).props.bold).toBe(true)
    expect((await shown(ui, { type: 'Text', text: exactly('hooks/ui/') })).props.dimColor).toBe(true)
    // the editors in spawn order, as Files and Changes say them
    expect((await shown(ui, { type: 'Text', text: exactly('Shared: Phase A + B are both on it now.') })).props.color).toBe(T.warn)
    await shown(ui, { type: 'Text', text: exactly('Uncommitted in git: +2 −1 against HEAD.') })
    expect(await rails(ui)).toHaveLength(1)

    // its hunks by agent: Phase B's first (it edited first), then Phase A's; nothing of the other file
    expect(await buttonKeys(ui, 'detail:agent:')).toEqual(['detail:agent:agent-b', 'detail:agent:agent-a'])
    const codes = await ui.findAll({ type: 'Code' })
    expect(codes.length).toBe(2)
    expect(String(codes[0]?.props.source)).toContain(B_LINE)
    expect(String(codes[0]?.props.source)).not.toContain(A_LINE)
    expect(String(codes[1]?.props.source)).toContain(A_LINE)
    expect(codes.some(code => String(code.props.source).includes('+elsewhere'))).toBe(false)
    expect(codes.every(code => code.props.format === 'diff' && code.props.path === 'hooks/ui/agents.tsx')).toBe(true)

    await ui.press({ plugin: 'test', key: 'detail:agent:agent-a' })
    expect(calls).toContain('select:agent-a')
    model.view.agent = 'file:hooks/ui/agents.tsx'

    // Open in Changes: the file opened there, then the tab
    await ui.press({ plugin: 'test', key: 'detail:changes' })
    expect(calls.slice(-2)).toEqual(['selectFile:hooks/ui/agents.tsx', 'setTab:changes'])
    expect(model.view.file).toBe('hooks/ui/agents.tsx')
    await ui.redraw()
    await ui.press({ plugin: 'test', key: 'detail:changes' })
    expect(calls.slice(-1)).toEqual(['setTab:changes'])
    expect(model.view.file).toBe('hooks/ui/agents.tsx')
    await ui.unmount()
  }

  // git's note leaves a zero side out, as +a −r does everywhere
  model.git = gitOf([{ path: 'hooks/ui/agents.tsx', code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 4, removed: 0 }])
  model.view.agent = 'file:hooks/ui/agents.tsx'
  const added = await $.ui.mount(mountOn('desktop'))
  await shown(added, { type: 'Text', text: exactly('Uncommitted in git: +4 against HEAD.') })
  expect(await added.find({ type: 'Text', text: /−0/ })).toBeUndefined()
  await added.unmount()

  // a file nobody changed: one plain sentence
  model.view.agent = 'file:nowhere.txt'
  const ui = await $.ui.mount(mountOn('desktop'))
  await shown(ui, { type: 'Text', text: /^No changes to nowhere\.txt are kept\./ })
  await ui.unmount()
})

// The bounds.

test('the detail stays inside the host bounds with two hundred messages and long diffs, every diff block under 10,000 characters', async ($, on) => {
  mock.clock(on, { now: NOW })
  const data = deckData()
  const a = agentIn(data, 'agent-a', 'Phase A', { prompt: TASK.repeat(4) })
  for (let i = 0; i < 24; i++) {
    const lines = Array.from({ length: 120 }, (_, n) => `+  const line${n} = '${'x'.repeat(60)}'`)
    editBy(data, a, `src/file-${i % 8}.ts`, lines, NOW - 9 * MIN + i)
  }
  for (let i = 0; i < 200; i++) say(data, i % 2 === 0 ? M.MAIN : a.id, i % 2 === 0 ? a.id : M.MAIN, 'message', `Message ${i}: ${'words '.repeat(100)}`, NOW - 8 * MIN + i)
  const model = modelOf(data)
  const { actions } = recorder(model)
  probe(on, kit => detailBlock(kit, detailVM(model.data, model.view, model.git, model.chat, model.fileDiff, model.now), actions))
  world(on)

  for (const surface of SURFACES) {
    for (const [agent, pane] of [
      ['agent-a', 'edits'],
      ['agent-a', 'chat'],
      [M.MAIN, 'chat'],
      ['file:src/file-3.ts', 'edits'],
    ] as const) {
      model.view.agent = agent
      model.view.agentPane = pane
      const ui = await $.ui.mount(mountOn(surface))
      const drawn = await ui.drawn()
      expect(treeSize(drawn).chars).toBeLessThanOrEqual(DETAIL_CHARS)
      const codes = await ui.findAll({ type: 'Code' })
      expect(codes.every(code => String(code.props.source).length <= 10_000)).toBe(true)
      if (pane === 'edits') {
        expect(codes.length).toBeGreaterThan(0)
        await shown(ui, { type: 'Text', text: /cut to fit the pane|not shown/i })
      }
      await ui.unmount()
    }
  }
})

// Through the deck's own pane: the outline routes to the detail, and the field sends through the engine.

test('through the deck pane: the outline picks fixer and the detail follows, Talk sends through session.send, a Files row opens its file', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const sent: Sent[] = []
  world(on, sent)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('details'))
  await clock.advance(1000)

  // you ask; the Orchestrator hands the fix to fixer, which lists its steps and edits src/token.js
  await $.turn.start({ text: PROMPT, turnId: 'turn-main' })
  await $.agent.spawn(spawn('fixer', 'general-purpose', FIXER_TASK))
  await $.tool.call(
    inLoop('agent-fixer', {
      tool: 'TodoWrite' as const,
      todos: [
        { content: 'Read src/token.js', status: 'completed' as const, activeForm: 'Reading src/token.js' },
        { content: 'Fix needsRefresh()', status: 'in_progress' as const, activeForm: 'Fixing needsRefresh()' },
        { content: 'Add two tests', status: 'pending' as const, activeForm: 'Adding two tests' },
      ],
    }),
  )
  await $.tool.call(inLoop('agent-fixer', { tool: 'Edit' as const, file_path: '/repo/src/token.js', old_string: 'before', new_string: 'after' }))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'tab:agents' })
    await ui.press({ key: 'agent:agent-fixer' })
    await ui.press({ key: 'detail:edits' })

    // the detail: fixer's header, its task, its checklist with the item in hand bold, its exact patch
    expect((await leaves(ui, exactly('fixer'))).some(one => one.props.bold === true)).toBe(true)
    await shown(ui, { type: 'Text', text: exactly(FIXER_TASK) })
    expect((await leaves(ui, exactly('Fixing needsRefresh()'))).some(one => one.props.bold === true)).toBe(true)
    await shown(ui, { type: 'Text', text: exactly('Read src/token.js') })
    await shown(ui, { type: 'Text', text: exactly('Add two tests') })
    const code = await shown(ui, { type: 'Code' })
    expect(code.props.format).toBe('diff')
    expect(String(code.props.source)).toContain(FIX_LINE)

    // Files: the file fixer is editing, its row a press away
    const row = (await buttonKeys(ui, 'files:')).find(key => key.endsWith('src/token.js'))
    if (!row) throw new Error(`no Files row for src/token.js: ${JSON.stringify(await buttonKeys(ui, 'files:'))}`)
    await shown(ui, { type: 'Text', text: exactly('fixer · editing') })

    // Talk: its task came from the Orchestrator; the field sends to fixer through session.send
    await ui.press({ key: 'detail:chat' })
    const routes = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('msg:')).map(button => button.props.label)
    expect(routes).toContain('Orchestrator → fixer')
    await ui.input({ key: 'chat:agent-fixer', text: `  hello from ${surface}  ` })
    await ui.press({ key: 'detail:edits' })

    // the Files row opens the file in the detail: its hunks under the agent that made them
    await ui.press({ key: row })
    await shown(ui, { key: 'detail:agent:agent-fixer' })
    expect((await shown(ui, { type: 'Text', text: exactly('token.js') })).props.bold).toBe(true)
    expect(String((await shown(ui, { type: 'Code' })).props.source)).toContain(FIX_LINE)
    await ui.press({ key: 'agent:main' })
    await ui.unmount()
  }

  expect(sent).toEqual([
    { to: 'agent-fixer', text: 'hello from terminal' },
    { to: 'agent-fixer', text: 'hello from desktop' },
  ])
})
