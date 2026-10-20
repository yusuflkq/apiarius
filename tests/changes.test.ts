import type { On, RenderElement } from 'claude-code'
import { expect, mock, test, type ElementQuery, type FoundElement } from 'claude-code/testing'

import { hunksOf } from '../hooks/diff'
import { emptyGit, type CommitDetail, type GitState } from '../hooks/git'
import * as M from '../hooks/model'
import { changesTab } from '../hooks/ui/changes'
import { statsTab } from '../hooks/ui/stats'
import { T } from '../hooks/ui/theme'
import type { Actions, DeckModel, Kit } from '../hooks/ui/types'

const NOW = 1_700_000_100_000
const HASH = 'a'.repeat(40)
const OLD_HASH = 'b'.repeat(40)
const PROBE = 'changes-probe'
const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  title: 'Agent Deck',
  isFocused: true,
  bodyColumns: 96,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

const VIEWPORT = { columns: 100, rows: 50, isFullscreen: true }

const APP_DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  ' export { a, b }',
  '',
].join('\n')

/** A deck model on a repository at /repo: HEAD at HASH, nothing uncommitted, an hour into the session. */
function modelOf(git: Partial<GitState> = {}): DeckModel {
  return {
    data: M.emptyData(NOW - 3_600_000),
    view: M.defaultView(),
    git: { ...emptyGit(), isRepo: true, root: '/repo', branch: 'main', head: HASH, checkedAt: NOW, repos: [{ root: '/repo', name: 'repo', lastEditAt: 0, isCwd: true }], ...git },
    fileDiff: null,
    commit: null,
    chat: null,
    usage: null,
    days: [],
    now: NOW,
    cwd: '/repo',
  }
}

/** A subagent named `name` in the model, its edit of `path` recorded with the patch it made. */
function addEditor(model: DeckModel, id: string, name: string, path: string) {
  model.data.agents.push(M.newAgent(id, 'agent', name, NOW - 600_000, { type: 'general-purpose', parentId: M.MAIN, status: 'completed' }))
  model.data.edits.push({
    id: `edit-${id}`,
    agent: id,
    tool: 'Edit',
    path,
    abs: `/repo/${path}`,
    at: NOW - 120_000,
    added: 1,
    removed: 1,
    patch: '@@ -1,3 +1,3 @@\n const a = 1\n-const b = 2\n+const b = 3\n export { a, b }',
    isNew: false,
  })
}

/** Actions that note each call; selecting a file or a commit toggles it in the current model's view, as the hooks module does. */
function recorder(current: () => DeckModel): { actions: Actions; calls: string[] } {
  const calls: string[] = []
  const note = (name: string) => (arg?: unknown) => {
    calls.push(arg === undefined ? name : `${name}:${String(arg)}`)
  }
  const actions: Actions = {
    setTab: note('setTab'),
    select: note('select'),
    toggleFold: note('toggleFold'),
    zoomTo: note('zoomTo'),
    selectAgent: note('selectAgent'),
    setAgentPane: note('setAgentPane'),
    selectFile: path => {
      calls.push(`selectFile:${path}`)
      const { view } = current()
      view.file = view.file === path ? '' : path
    },
    selectCommit: hash => {
      calls.push(`selectCommit:${hash}`)
      const { view } = current()
      view.commit = view.commit === hash ? '' : hash
    },
    setFilter: note('setFilter'),
    toggleFiles: note('toggleFiles'),
    toggleBand: note('toggleBand'),
    refresh: note('refresh'),
    sendChat: (agentId, text) => {
      calls.push(`sendChat:${agentId}:${text}`)
    },
    review: note('review'),
    open: note('open'),
    selectRepo: note('selectRepo'),
    openWeb: note('openWeb'),
    toggleDetails: note('toggleDetails'),
    showDetails: note('showDetails'),
  }
  return { actions, calls }
}

/** Draws `draw`'s tree as the deck's pane would, under the PROBE instance, with the surface's own elements. */
function probe(on: On, draw: (kit: Kit) => RenderElement) {
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
      ...('Svg' in ui ? { Svg: ui.Svg } : {}),
    }
    return draw(kit)
  })
}

type Drawing = {
  find: (query: ElementQuery) => Promise<FoundElement | undefined>
  findAll: (query: ElementQuery) => Promise<FoundElement[]>
}

/** The element `query` finds, or a failure naming the query and the text that was drawn instead. */
async function shown(ui: Drawing, query: ElementQuery): Promise<FoundElement> {
  const found = await ui.find(query)
  if (found !== undefined) return found
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  const keys = (await ui.findAll({ type: 'Button' })).map(one => one.key)
  throw new Error(`not drawn: ${String(query.text ?? '')} ${query.key ?? ''} ${query.type ?? ''}; texts: ${JSON.stringify(texts).slice(0, 1800)}; buttons: ${JSON.stringify(keys).slice(0, 600)}`)
}

function mountOn(surface: (typeof SURFACES)[number], bodyColumns: number = PANE.bodyColumns) {
  return { plugin: 'agent-deck', surface, component: 'Pane' as const, requestId: PROBE, viewport: VIEWPORT, props: { ...PANE, bodyColumns } }
}

test('the files list shows each file with the agents that touched it, and pressing one opens its hunks as a diff', async ($, on) => {
  mock.clock(on, { now: NOW })
  const model = modelOf({
    files: [
      { path: 'src/app.ts', code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 1, removed: 1 },
      { path: 'notes.txt', code: 'N', isStaged: false, isUnstaged: false, isUntracked: true, isBinary: false, added: 2, removed: 0 },
    ],
    added: 3,
    removed: 1,
  })
  addEditor(model, 'a1', 'fixer', 'src/app.ts')
  addEditor(model, 'a2', 'scout', 'src/app.ts')
  const { actions, calls } = recorder(() => model)
  probe(on, kit => changesTab(kit, model, actions))

  for (const surface of SURFACES) {
    model.view.file = ''
    model.fileDiff = null
    const ui = await $.ui.mount(mountOn(surface))

    await shown(ui, { type: 'Text', text: /repo ⎇ main/ })
    await shown(ui, { type: 'Text', text: /in 2 files vs aaaaaaa/ })
    expect((await ui.find({ key: 'file:src/app.ts' }))?.props.label).toBe('src/app.ts')
    await shown(ui, { key: 'file:notes.txt' })
    // the editors as every list says them: spawn order, joined with +
    await shown(ui, { type: 'Text', text: 'by fixer + scout' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()

    await ui.press({ plugin: 'test', key: 'file:src/app.ts' })
    expect(calls).toContain('selectFile:src/app.ts')
    await ui.redraw()
    await shown(ui, { type: 'Text', text: /Reading the diff/ })

    model.fileDiff = { path: 'src/app.ts', hunks: hunksOf(APP_DIFF), isBinary: false, at: NOW }
    await ui.redraw()
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(String(code?.props.source)).toContain('+const b = 3')
    expect(String(code?.props.source).startsWith('@@ -1,3 +1,3 @@')).toBe(true)

    await ui.press({ plugin: 'test', key: 'review:src/app.ts' })
    expect(calls.some(call => call.startsWith('review:') && call.includes('diff HEAD -- "src/app.ts"'))).toBe(true)
    await ui.press({ plugin: 'test', key: 'review' })
    expect(calls.some(call => call.startsWith('review:') && call.includes('uncommitted changes in /repo'))).toBe(true)

    await ui.press({ plugin: 'test', key: 'file:src/app.ts' })
    await ui.redraw()
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the repo picker appears with two repositories and follows the work as the empty value', async ($, on) => {
  mock.clock(on, { now: NOW })
  const model = modelOf({
    repos: [
      { root: '/repo', name: 'repo', lastEditAt: NOW - 60_000, isCwd: true },
      { root: '/work/app', name: 'app', lastEditAt: NOW - 30_000, isCwd: false },
    ],
  })
  const { actions, calls } = recorder(() => model)
  probe(on, kit => changesTab(kit, model, actions))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(mountOn(surface))
    const picker = await ui.find({ key: 'repo' })
    expect(picker?.type).toBe('Select')
    expect(picker?.props.value).toBe('')
    expect((picker?.props.options as { value: string; label: string }[]).map(option => option.value)).toEqual(['', '/repo', '/work/app'])
    expect((picker?.props.options as { value: string; label: string }[])[0]?.label).toBe('Follow the work (repo)')

    await ui.select({ plugin: 'test', key: 'repo', value: '/work/app' })
    expect(calls).toContain('selectRepo:/work/app')
    await ui.select({ plugin: 'test', key: 'repo', value: '' })
    expect(calls).toContain('selectRepo:')
    await ui.unmount()
  }

  model.git = { ...model.git, repos: [{ root: '/repo', name: 'repo', lastEditAt: 0, isCwd: true }] }
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(mountOn(surface))
    expect(await ui.find({ key: 'repo' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a commit shows its marks, and pressing it opens its message, files and patch', async ($, on) => {
  mock.clock(on, { now: NOW })
  const model = modelOf({
    commits: [
      { hash: HASH, short: 'aaaaaaa', author: 'Sam', at: NOW - 300_000, subject: 'Fix the b constant', files: 1, added: 1, removed: 1 },
      { hash: OLD_HASH, short: 'bbbbbbb', author: 'Sam', at: NOW - 86_400_000, subject: 'First commit', files: 3, added: 40, removed: 0 },
    ],
    today: { commits: 1, added: 1, removed: 1 },
    sessionCommits: 1,
  })
  addEditor(model, 'a1', 'fixer', 'src/app.ts')
  model.data.commitsBy[HASH] = 'a1'
  const detail: CommitDetail = {
    hash: HASH,
    author: 'Sam',
    email: 'sam@example.com',
    at: NOW - 300_000,
    body: 'Fix the b constant\n\nb was 2; the callers expect 3.',
    files: [{ path: 'src/app.ts', added: 1, removed: 1, isBinary: false }],
    patch: APP_DIFF,
    isPatchCut: false,
  }
  const { actions, calls } = recorder(() => model)
  probe(on, kit => changesTab(kit, model, actions))

  for (const surface of SURFACES) {
    model.view.commit = ''
    model.commit = null
    const ui = await $.ui.mount(mountOn(surface))

    await shown(ui, { type: 'Text', text: /1 today · 1 this session/ })
    expect((await ui.find({ key: `commit:${HASH}` }))?.props.label).toBe('Fix the b constant')
    await shown(ui, { type: 'Text', text: 'this session · by fixer' })
    await shown(ui, { key: `commit:${OLD_HASH}` })
    await shown(ui, { type: 'Text', text: /Sam · 24h ago/ })

    await ui.press({ plugin: 'test', key: `commit:${HASH}` })
    expect(calls).toContain(`selectCommit:${HASH}`)
    await ui.redraw()
    await shown(ui, { type: 'Text', text: /Reading the commit/ })

    model.commit = detail
    await ui.redraw()
    await shown(ui, { type: 'Text', text: 'b was 2; the callers expect 3.' })
    await shown(ui, { type: 'Text', text: /sam@example\.com/ })
    await shown(ui, { type: 'Text', text: 'app.ts' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(String(code?.props.source)).toContain('-const b = 2')

    await ui.press({ plugin: 'test', key: `review-commit:${HASH}` })
    expect(calls.some(call => call.startsWith('review:') && call.includes('show aaaaaaaaaa'))).toBe(true)
    await ui.unmount()
  }
})

test('the clean, loading, error and no-repository states each say so in one line', async ($, on) => {
  mock.clock(on, { now: NOW })
  let model = modelOf()
  const { actions, calls } = recorder(() => model)
  probe(on, kit => changesTab(kit, model, actions))

  for (const surface of SURFACES) {
    model = modelOf()
    let ui = await $.ui.mount(mountOn(surface))
    await shown(ui, { type: 'Text', text: /Working tree clean/ })
    await shown(ui, { type: 'Text', text: /clean at aaaaaaa/ })
    await shown(ui, { type: 'Text', text: /No commits to show/ })
    expect(await ui.find({ key: 'review' })).toBeUndefined()
    await ui.unmount()

    model = modelOf({ isRepo: null, root: '', head: '', branch: '' })
    ui = await $.ui.mount(mountOn(surface))
    await shown(ui, { type: 'Text', text: 'Reading git…' })
    expect(await ui.find({ type: 'Text', text: /Commits/ })).toBeUndefined()
    await ui.unmount()

    model = modelOf({ isRepo: false, head: '', branch: '', error: 'fatal: Unable to create index.lock: File exists.' })
    addEditor(model, 'a1', 'fixer', 'src/app.ts')
    ui = await $.ui.mount(mountOn(surface))
    await shown(ui, { type: 'Text', text: /git failed in repo: fatal: Unable to create index\.lock/ })
    await shown(ui, { key: 'file:src/app.ts' })
    await ui.unmount()

    model = modelOf({ isRepo: false, root: '', head: '', branch: '', repos: [] })
    model.cwd = '/notes'
    ui = await $.ui.mount(mountOn(surface))
    await shown(ui, { type: 'Text', text: 'No git repository at /notes.' })
    await shown(ui, { type: 'Text', text: /No edits by agents yet/ })
    await ui.unmount()

    // outside a repository the edits agents made stand in for git's files, each from its own patch
    model = modelOf({ isRepo: false, root: '', head: '', branch: '', repos: [] })
    model.cwd = '/notes'
    addEditor(model, 'a1', 'fixer', '/notes/plan.md')
    ui = await $.ui.mount(mountOn(surface))
    await shown(ui, { type: 'Text', text: /No git repository at \/notes; the edits agents made are below/ })
    await ui.press({ plugin: 'test', key: 'file:/notes/plan.md' })
    expect(calls).toContain('selectFile:/notes/plan.md')
    await ui.redraw()
    await shown(ui, { type: 'Text', text: /Edit by fixer · 2m ago/ })
    expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
    await ui.unmount()
  }
})

test('a busy repository stays inside the tree bounds: rows capped, every diff cut to the budget and still a diff', async ($, on) => {
  mock.clock(on, { now: NOW })
  const lines = Array.from({ length: 900 }, (_, i) => `+export const value${i} = ${'x'.repeat(60)}`)
  const bigDiff = `@@ -0,0 +1,900 @@\n${lines.join('\n')}\n`
  const files = Array.from({ length: 70 }, (_, i) => ({
    path: `packages/some-long-package-name/src/components/deeply/nested/file-${i}.tsx`,
    code: 'M' as const,
    isStaged: false,
    isUnstaged: true,
    isUntracked: false,
    isBinary: false,
    added: 900,
    removed: 12,
  }))
  const commits = Array.from({ length: 30 }, (_, i) => ({
    hash: `${String(i).padStart(2, '0')}${'c'.repeat(38)}`,
    short: `${String(i).padStart(2, '0')}ccccc`,
    author: 'Sam',
    at: NOW - i * 3_600_000,
    subject: `A commit subject long enough to need cutting in a narrow pane, number ${i}`,
    files: 40,
    added: 900,
    removed: 30,
  }))
  const model = modelOf({ files, commits, added: 63_000, removed: 840 })
  for (let i = 0; i < 6; i++) addEditor(model, `a${i}`, `worker-${i}`, files[0]?.path ?? '')
  const open = commits[0]?.hash ?? ''
  model.view.file = files[0]?.path ?? ''
  model.view.commit = open
  model.fileDiff = { path: model.view.file, hunks: hunksOf(bigDiff), isBinary: false, at: NOW }
  const patch = Array.from({ length: 40 }, (_, i) => `diff --git a/f${i}.ts b/f${i}.ts\n--- a/f${i}.ts\n+++ b/f${i}.ts\n${bigDiff}`).join('')
  model.commit = {
    hash: open,
    author: 'Sam',
    email: 'sam@example.com',
    at: NOW,
    body: 'Subject',
    files: Array.from({ length: 40 }, (_, i) => ({ path: `f${i}.ts`, added: 900, removed: 0, isBinary: false })),
    patch,
    isPatchCut: true,
  }
  const { actions } = recorder(() => model)
  probe(on, kit => changesTab(kit, model, actions))

  for (const surface of SURFACES) {
    for (const columns of [40, 96, 200]) {
      const ui = await $.ui.mount(mountOn(surface, columns))
      const size = JSON.stringify(await ui.drawn()).length
      expect(size <= 72_000, `${size} characters at ${columns} columns on ${surface}`).toBe(true)
      const codes = await ui.findAll({ type: 'Code' })
      expect(codes.length > 0).toBe(true)
      let total = 0
      for (const code of codes) {
        const source = String(code.props.source)
        total += source.length
        expect(source.length <= 10_000, `a Code of ${source.length} characters`).toBe(true)
        // each hunk's header counts what it holds, so the cut still parses as a diff
        for (const hunk of hunksOf(source)) {
          const context = hunk.lines.filter(line => line[0] === ' ').length
          expect(hunk.oldLines + hunk.newLines - context).toBe(hunk.lines.length)
        }
      }
      expect(total <= 40_000, `${total} characters of diff`).toBe(true)
      await shown(ui, { type: 'Text', text: /^\d+ more files$/ })
      const commitRows = (await ui.findAll({ type: 'Button', text: /^A commit/ })).length
      expect(commitRows >= 10 && commitRows <= 20, `${commitRows} commit rows`).toBe(true)
      await ui.unmount()
    }
  }
})

test('stats cards show on both surfaces, as a strip of Svg cards from the theme on the desktop', async ($, on) => {
  mock.clock(on, { now: NOW })
  const model = modelOf({
    files: [{ path: 'src/app.ts', code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 1, removed: 1 }],
    sessionCommits: 1,
    today: { commits: 3, added: 10, removed: 2 },
  })
  addEditor(model, 'a1', 'fixer', 'src/app.ts')
  const main = M.agentOf(model.data, M.MAIN)
  if (main) Object.assign(main, { tools: 200, errors: 4, tokensIn: 20_000, tokensOut: 5_000, cacheRead: 80_000, added: 420, removed: 35, files: ['src/app.ts'] })
  model.data.turnMs = 38 * 60_000
  model.data.minutes = [
    { m: M.minuteOf(NOW) - 3, tools: 12, edits: 2, tokens: 0 },
    { m: M.minuteOf(NOW), tools: 5, edits: 1, tokens: 0 },
  ]
  model.usage = { startedAt: NOW - 72 * 60_000, contextPercent: 12.4, costUsd: 1.25, limits: [] }
  model.days = Array.from({ length: 7 }, (_, i) => ({
    day: `2023-11-${String(8 + i).padStart(2, '0')}`,
    added: i * 10,
    removed: i * 2,
    tools: 0,
    tokens: 0,
    sessions: 1,
    activeMs: 0,
  }))
  const { actions } = recorder(() => model)
  probe(on, kit => statsTab(kit, model, actions))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(mountOn(surface))
    const svgs = await ui.findAll({ type: 'Svg' })
    if (surface === 'desktop') {
      expect(svgs.length).toBe(3)
      const [strip, activity, week] = svgs.map(svg => String(svg.props.source))
      for (const label of ['Session', 'Tool calls', 'Lines by agents', 'Uncommitted files', 'Tokens', 'Cost']) expect(strip).toContain(label)
      for (const figure of ['1h 12m', '38m working', '4 failed (2%)', '+420', '−35', '1 commit · 3 today', '80% from cache', '$1.25', 'context 12% full']) expect(strip).toContain(figure)
      expect(strip).toContain(T.panel)
      expect(strip).toContain(T.fontMono)
      expect(strip).toContain('font-size="18"')
      expect(strip).toContain('font-size="11"')
      expect(activity).toContain('Activity')
      expect(activity).toContain(T.bg)
      expect(week).toContain(T.ok)
      expect(week).toContain(T.err)
      for (const svg of svgs) {
        expect(svg.props.isInteractive).toBeUndefined()
        expect(String(svg.props.alt).length > 0).toBe(true)
      }
      expect(await ui.find({ type: 'Text', text: /Tool calls/ })).toBeUndefined()
    } else {
      expect(svgs.length).toBe(0)
      await shown(ui, { type: 'Text', text: 'Tool calls' })
      await shown(ui, { type: 'Text', text: '1h 12m' })
      await shown(ui, { type: 'Text', text: /\+420/ })
      await shown(ui, { type: 'Text', text: /17 tool calls/ })
      await shown(ui, { type: 'Text', text: /\+210 added/ })
    }

    // the same data a few seconds on draws the same tree: no figure moves under a minute
    const before = JSON.stringify(await ui.drawn())
    model.now = NOW + 20_000
    await ui.redraw()
    expect(JSON.stringify(await ui.drawn())).toBe(before)
    model.now = NOW
    await ui.unmount()
  }
})

test('stats on a fresh session: zero figures quiet, no history yet', async ($, on) => {
  mock.clock(on, { now: NOW })
  const model = modelOf({ isRepo: false, root: '', head: '', branch: '', repos: [] })
  model.data = M.emptyData(NOW - 10_000)
  const { actions } = recorder(() => model)
  probe(on, kit => statsTab(kit, model, actions))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(mountOn(surface, 60))
    await shown(ui, { type: 'Text', text: /No history yet/ })
    if (surface === 'desktop') {
      const strip = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(strip).toContain('&#60;1m')
      expect(strip).toContain('no repository')
      expect(strip).toContain(T.text4)
    } else {
      await shown(ui, { type: 'Text', text: 'no repository' })
      await shown(ui, { type: 'Text', text: '<1m' })
    }
    await ui.unmount()
  }
})

// Through the deck's own pane: the router draws these tabs, and the hooks module runs git (stubbed below) and the presses.

const X_DIFF = ['diff --git a/lib/x.ts b/lib/x.ts', '--- a/lib/x.ts', '+++ b/lib/x.ts', '@@ -1,1 +1,4 @@', ' export {}', '+const x = 1', '+const y = 2', '+const z = 3', ''].join('\n')

/** The repositories on a make-believe disk, by root as git prints it: branch, status, numstat, and each file's diff. */
const DISK: Record<string, { branch: string; status: string; numstat: string; diffs: Record<string, string> }> = {
  '/repo': { branch: 'main', status: ' M src/app.ts\0?? notes.txt\0', numstat: '1\t1\tsrc/app.ts\0', diffs: { 'src/app.ts': APP_DIFF } },
  '/other': { branch: 'dev', status: ' M lib/x.ts\0', numstat: '3\t0\tlib/x.ts\0', diffs: { 'lib/x.ts': X_DIFF } },
}

/** What git prints for `argv` run in `cwd`: the top level anywhere inside a repository, the rest at its root alone. */
function gitAt(argv: readonly string[], cwd: string): { exitCode: number; stdout: string } {
  const line = argv.join(' ')
  const root = Object.keys(DISK).find(one => cwd === one || cwd.startsWith(`${one}/`))
  if (!root) return { exitCode: 128, stdout: '' }
  if (line.includes('rev-parse --show-toplevel')) return { exitCode: 0, stdout: `${root}\n` }
  if (cwd !== root) return { exitCode: 128, stdout: '' }

  const repo = DISK[root]!
  const diffOf = /-M -U3 HEAD -- (.+)$/.exec(line)
  if (diffOf) return { exitCode: 0, stdout: repo.diffs[diffOf[1] ?? ''] ?? '' }
  if (line.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: `${repo.branch}\n` }
  if (line.includes('rev-parse --verify --quiet HEAD')) return { exitCode: 0, stdout: `${HASH}\n` }
  if (line.includes('@{upstream}')) return { exitCode: 128, stdout: '' }
  if (line.includes('status --porcelain')) return { exitCode: 0, stdout: repo.status }
  if (line.includes('--numstat -z HEAD')) return { exitCode: 0, stdout: repo.numstat }
  if (line.includes('rev-list --count')) return { exitCode: 0, stdout: '1\n' }
  if (line.includes(' log --since')) return { exitCode: 0, stdout: '\x1e\n 1 file changed, 2 insertions(+)\n' }
  if (line.includes(' log -n30')) {
    return { exitCode: 0, stdout: `\x1e${HASH}\x1f${HASH.slice(0, 7)}\x1fSam\x1f1700000000\x1fFirst commit\n\n 1 file changed, 2 insertions(+)\n` }
  }
  if (line.includes('show -s')) return { exitCode: 0, stdout: `${HASH}\x1fSam\x1fsam@example.com\x1f1700000000\x1fFirst commit\n` }
  if (line.includes('--numstat -z') && line.includes(HASH)) return { exitCode: 0, stdout: '\n1\t1\tsrc/app.ts\0' }
  if (line.includes('--format= -U3')) return { exitCode: 0, stdout: APP_DIFF }
  return { exitCode: 1, stdout: '' }
}

/** Answers every engine call the deck makes, in Claude Code's place; what a review press puts in the prompt lands in `filled`. */
function world(on: On, filled: string[]) {
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } } }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', ($, e) => ({ value: { ...gitAt(e.argv, (e.init?.cwd ?? '').replace(/\\/g, '/')), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: NOW, isLink: false } }))
  on('fs.read', () => ({ value: 'hello\nworld\n' }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($, e) => {
    if (e.tool !== 'Edit') return { result: 'ok' }
    return {
      result: {
        filePath: String(e.file_path),
        oldString: 'const b = 2',
        newString: 'const b = 3',
        originalFile: 'const a = 1\nconst b = 2\nexport { a, b }\n',
        structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' const a = 1', '-const b = 2', '+const b = 3', ' export { a, b }'] }],
        userModified: false,
        replaceAll: false,
      },
    }
  })
}

/** /deck as typed at the prompt, with what the engine stamps on it. */
function deck(args: string) {
  return { command: 'deck', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 100 } }
}

function edit(file: string) {
  return { tool: 'Edit' as const, file_path: file, old_string: 'const b = 2', new_string: 'const b = 3' }
}

function pane(surface: (typeof SURFACES)[number]) {
  return { plugin: 'agent-deck', surface, component: 'Pane' as const, requestId: 'agent-deck', viewport: VIEWPORT, props: PANE }
}

test('through the pane: Changes lists the files and who edited them, opens a diff and a commit, and the picker pins a repository', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const filled: string[] = []
  world(on, filled)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('changes'))
  await $.tool.call(edit('/repo/src/app.ts'))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'tab:changes' }))?.props.dimColor).toBe(false)
    await shown(ui, { type: 'Text', text: /^repo ⎇ main · \+3 −1 in 2 files vs aaaaaaa$/ })
    await shown(ui, { key: 'file:notes.txt' })
    await shown(ui, { type: 'Text', text: 'by Orchestrator' })
    expect(await ui.find({ key: 'repo' })).toBeUndefined()

    await ui.press({ key: 'file:src/app.ts' })
    const code = await shown(ui, { type: 'Code' })
    expect(code.props.format).toBe('diff')
    expect(String(code.props.source)).toContain('+const b = 3')
    await ui.press({ key: 'review:src/app.ts' })
    expect(filled[filled.length - 1]).toContain('git -C "/repo" diff HEAD -- "src/app.ts"')
    await ui.press({ key: 'file:src/app.ts' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()

    await ui.press({ key: `commit:${HASH}` })
    await shown(ui, { key: `review-commit:${HASH}` })
    expect(String((await shown(ui, { type: 'Code' })).props.source)).toContain('-const b = 2')
    await ui.press({ key: `commit:${HASH}` })
    await ui.unmount()
  }

  // an edit in a second repository: the deck follows it, and the picker pins either one or follows the work again
  await $.tool.call(edit('/other/lib/x.ts'))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const picker = await shown(ui, { key: 'repo' })
    expect((picker.props.options as { value: string }[]).map(option => option.value)).toEqual(['', '/other', '/repo'])
    await shown(ui, { type: 'Text', text: /^other ⎇ dev/ })
    await shown(ui, { key: 'file:lib/x.ts' })

    await ui.select({ key: 'repo', value: '/repo' })
    await shown(ui, { type: 'Text', text: /^repo ⎇ main/ })
    expect((await ui.find({ key: 'repo' }))?.props.value).toBe('/repo')
    await shown(ui, { key: 'file:src/app.ts' })

    await ui.select({ key: 'repo', value: '' })
    await shown(ui, { type: 'Text', text: /^other ⎇ dev/ })
    expect((await ui.find({ key: 'repo' }))?.props.value).toBe('')
    await ui.unmount()
  }
})

test('through the pane: Stats draws the session cards on each surface, a strip of Svg on the desktop', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, [])

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('stats'))
  await $.tool.call(edit('/repo/src/app.ts'))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // off the tab row: no tab of it lit over Stats
    expect(await ui.find({ key: 'tab:stats' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('tab:') && button.props.dimColor === false)).toEqual([])
    await shown(ui, { type: 'Text', text: /No history yet/ })
    if (surface === 'desktop') {
      const [strip, activity] = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.source))
      for (const words of ['Session', 'Tool calls', 'Lines by agents', 'Uncommitted files', 'Tokens', 'Cost', '$1.25', 'context 12% full']) expect(strip).toContain(words)
      expect(activity).toContain('Activity')
      expect(await ui.find({ type: 'Text', text: 'Tool calls' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      await shown(ui, { type: 'Text', text: 'Tool calls' })
      await shown(ui, { type: 'Text', text: '$1.25' })
      await shown(ui, { type: 'Text', text: 'context 12% full' })
      await shown(ui, { type: 'Text', text: /\d+ tool calls?$/ })
    }
    await ui.unmount()
  }
})
