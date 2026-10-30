/**
 * Changes with no repository to show, and the agents' edits as rows that
 * plainly open: where the chat runs and that Changes follows the repository
 * an agent edits in, the repositories directly inside its directory to pick
 * from (`changes.where`, the page's `selectRepo`), and every edit the agents
 * made, a row a file as the web page's (a chevron, its path, the faces of
 * who edited it, "2 edits", `+a −r`), the newest open the first time;
 * git's files with their chevrons and editors' faces too. On the terminal
 * and the desktop, drawn by `/apiarius demo` over the v2 sample laid out as a
 * chat outside any repository, or live through the hooks.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit, type GitState } from '../hooks/git'
import * as M from '../hooks/model'
import { editGroupsOf, noRepoText } from '../hooks/ui/v2/changes'
import * as W from '../hooks/web'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { command, deck, lastState, newWorld, NOW, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const
const DOCUMENTS = 'C:\\Users\\sam\\Documents'
const PICKS = [
  { root: 'C:/Users/sam/Documents/apiarius', name: 'apiarius' },
  { root: 'C:/Users/sam/Documents/notes-app', name: 'notes-app' },
]

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

async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

async function keysOf(ui: { findAll: (q: { type: 'Button' }) => Promise<{ key?: string }[]> }, prefix: string): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith(prefix))
}

function nodesOf(node: unknown): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node !== 'object') return 1
  return 1 + ((node as { children?: unknown[] }).children ?? []).reduce((sum: number, child) => sum + nodesOf(child), 0)
}

/** Git as the deck holds it for a chat in Documents, no repository: the repositories inside it found. */
const NO_REPO: GitState = { ...emptyGit(), isRepo: false, isCwdRepo: false, checkedAt: SAMPLE_NOW, nearby: PICKS }

/** The v2 sample as a chat in Documents would show it: no repository, every path the agents edited absolute, as the deck makes them with none. */
function noRepoState(): W.WebStateV2 {
  const session = v2Session()
  for (const edit of session.data.edits) edit.path = M.relOf(edit.abs, null)
  for (const file of Object.values(session.data.files)) file.path = M.relOf(file.abs, null)
  return W.deckStateOf(session.data, NO_REPO, session.usage, session.now, session.sessionId, DOCUMENTS, session.answerable)
}

/** `/apiarius demo` reads `state` as the sample, with the sample's agent files and patches. */
async function demo($: Engine, on: On, state: W.WebStateV2) {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const session = v2Session()
  const agentFiles = new Map(W.agentFilesOf(session.data).map(one => [one.id, one.text]))
  const patches = new Map(session.data.edits.map(edit => [W.webIdOf(edit.id), edit.patch]))
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(state) }
    const agent = /\/web\/fixtures\/v2\/agents\/([^/]+)\.json$/.exec(path)?.[1]
    if (agent && agentFiles.has(agent)) return { value: agentFiles.get(agent)! }
    const patch = /\/web\/fixtures\/v2\/patches\/([^/]+)\.diff$/.exec(path)?.[1]
    if (patch && patches.has(patch)) return { value: patches.get(patch)! }
    return { deny: 'no such file' }
  })
  on('ui.focus', () => ({}))
  const w = newWorld()
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  return { clock, w }
}

test('the state says where the chat runs and how Changes picks its repository: its folder and that folder`s name, whether it is in one, the pin, and the picks inside it while it is in none', () => {
  const state = noRepoState()
  expect(state.changes.repo).toBeNull()
  expect(state.changes.where).toEqual({ cwd: DOCUMENTS, name: 'Documents', isRepo: false, pinned: '', picks: PICKS })
  expect(state.changes.edits.some(edit => edit.isOutside)).toBe(false)
  // the sample's own chat runs in its repository: nothing to pick
  const session = v2Session()
  const own = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd)
  expect(own.changes.where).toMatchObject({ name: 'acme-api', isRepo: true, pinned: '', picks: [] })
  // what Changes says: where it runs, and what it follows; git not asked yet; a pin git cannot read; an earlier build's state as it said it
  expect(noRepoText({ where: { cwd: DOCUMENTS, name: 'Documents', isRepo: false, pinned: '', picks: [] }, edits: [] })).toBe('This chat runs in Documents, which isn’t a git repository. Changes follows the repository an agent edits in.')
  expect(noRepoText(state.changes)).toBe('This chat runs in Documents, which isn’t a git repository. Changes follows the repository an agent edits in; the edits agents made outside one are below, exact.')
  expect(noRepoText({ where: { cwd: DOCUMENTS, name: 'Documents', isRepo: null, pinned: '', picks: [] }, edits: [] })).toBe('Looking for a git repository…')
  expect(noRepoText({ where: { cwd: DOCUMENTS, name: 'Documents', isRepo: false, pinned: 'C:/Users/sam/Documents/apiarius', picks: [] }, edits: [] })).toBe('Changes is pinned to apiarius, which git can’t read now.')
  expect(noRepoText({ edits: [] })).toBe('No git repository here.')
  // the edits by file, the one edited last first, each file's as listed
  const groups = editGroupsOf(state.changes.edits)
  expect(groups.map(group => [group.path, group.edits.length, group.agents, group.added, group.removed])).toEqual([
    ['C:/Users/sam/AppData/Local/Temp/bench.js', 1, [IDS.builder], 3, 0],
    ['C:/Users/sam/code/acme-api/src/rateLimit.ts', 2, [IDS.builder, IDS.tester], 7, 1],
    ['C:/Users/sam/code/acme-api/tests/rateLimit.test.ts', 1, [IDS.tester], 4, 0],
    ['C:/Users/sam/code/acme-api/docs/api.md', 1, [IDS.docs], 3, 1],
    ['C:/Users/sam/code/acme-api/src/app.ts', 1, [IDS.builder], 2, 1],
  ])
})

test('no repository: Changes names the folder the chat runs in and offers the repositories inside it; every edit a row that plainly opens (a chevron, its path, its agents` faces, "2 edits", +a −r), the newest open the first time; a press opens or shuts one; the Dashboard`s Files opens one there', async ($, on) => {
  const state = noRepoState()
  const { w } = await demo($, on, state)
  const bench = 'C:/Users/sam/AppData/Local/Temp/bench.js'
  const limiter = 'C:/Users/sam/code/acme-api/src/rateLimit.ts'
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:changes')
    expect((await ui.find({ key: 'changes:repo' }))?.text).toBe(noRepoText(state.changes))
    // the picks: each a plain Button by its name, beside its branch mark
    expect(await keysOf(ui, 'changes:pick:')).toEqual(PICKS.map(pick => `changes:pick:${pick.root}`))
    expect((await ui.find({ key: 'changes:picks' }))?.text).toContain('REPOSITORIES IN DOCUMENTS')
    expect((await ui.find({ key: 'changes:picks' }))?.text).toContain('⎇')
    await press(ui, `changes:pick:${PICKS[0]!.root}`)
    expect(w.toasts.at(-1)).toBe('Sample data: Changes shows the sample’s repository. Back to this chat to pick one of yours.')
    // a pick is one press with its branch mark: one Button of both on the terminal, a veil over both on a desktop
    const toasts = w.toasts.length
    if (surface === 'terminal') {
      expect((await ui.find({ key: `changes:pick:${PICKS[1]!.root}` }))?.text).toBe('⎇ notes-app')
    } else {
      expect(String((await ui.find({ key: `row:changes:pick:${PICKS[1]!.root}` }))?.props.label).trim()).toBe('')
      await press(ui, `row:changes:pick:${PICKS[1]!.root}`)
      expect(w.toasts.length).toBe(toasts + 1)
    }
    // a row a file, the one edited last first, as the web page's
    expect(await keysOf(ui, 'edits:')).toEqual(editGroupsOf(state.changes.edits).map(group => `edits:${group.path}`))
    expect((await ui.find({ key: `edits:${limiter}` }))?.props).toMatchObject({ plain: true })
    expect((await ui.find({ key: `edits:${limiter}` }))?.props.dimColor).toBeFalsy()
    const row = (await ui.find({ key: `editrow:${limiter}` }))?.text ?? ''
    for (const said of ['2 edits', '+7', '−1']) expect(row).toContain(said)
    if (surface === 'desktop') {
      // the chevron an icon, the faces one stacked image named by who they are
      expect((await ui.findAll({ type: 'Svg' })).some(svg => svg.props.alt === 'builder, tester')).toBe(true)
      expect((await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.alt === 'Open')).toHaveLength(1)
    } else {
      expect(row.startsWith('▸')).toBe(true)
      expect((await ui.find({ key: `editrow:${bench}` }))?.text.startsWith('▾')).toBe(true)
    }
    // the newest open: its tool, its agent, its patch; the others shut
    const open = (await ui.find({ key: `edited:${bench}` }))?.text ?? ''
    expect(open).toContain('Write by builder')
    const diffs = () => ui.findAll({ type: 'Code' }).then(all => all.filter(code => code.props.format === 'diff'))
    expect((await diffs()).length).toBe(1)
    expect(String((await diffs())[0]?.props.source)).toContain('10,000 hits against the in-memory store')
    // a press opens another, both of its edits; another shuts the newest
    await press(ui, `edits:${limiter}`)
    const both = (await ui.find({ key: `edited:${limiter}` }))?.text ?? ''
    expect(both).toContain('Write by builder')
    expect(both).toContain('Edit by tester')
    await press(ui, `edits:${bench}`)
    expect((await ui.find({ key: `edited:${bench}` }))?.text).not.toContain('Write by builder')
    expect((await diffs()).length).toBe(2)
    // inside the desktop's bounds, both open
    const tree = await ui.drawn()
    expect(nodesOf(tree)).toBeLessThan(2000)
    expect(JSON.stringify(tree).length).toBeLessThan(262_144)
    // as it was for the next surface
    await press(ui, `edits:${limiter}`)
    await press(ui, `edits:${bench}`)
    await press(ui, 'tab:now')
    await ui.unmount()
  }
  // the Dashboard's Files: a file Changes lists by its agents' edits opens there, open
  const ui = await $.ui.mount(pane('terminal'))
  await press(ui, 'now:file:C:/Users/sam/code/acme-api/docs/api.md')
  expect((await ui.find({ key: 'tab:changes' }))?.props.dimColor).toBe(false)
  expect((await ui.find({ key: 'edited:C:/Users/sam/code/acme-api/docs/api.md' }))?.text).toContain('Edit by docs')
  await ui.unmount()
})

test('git`s files: a chevron before each, open or shut, and the faces of the agents whose own edits touched it beside its path, as the web page`s rows', async ($, on) => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  await demo($, on, state)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:changes')
    expect((await ui.find({ key: 'file:src/app.ts' }))?.props.dimColor).toBeFalsy()
    if (surface === 'terminal') {
      expect((await ui.find({ key: 'filerow:src/app.ts' }))?.text.startsWith('▸ M src/app.ts')).toBe(true)
    } else {
      expect((await ui.findAll({ type: 'Svg' })).some(svg => svg.props.alt === 'builder, tester')).toBe(true)
    }
    await press(ui, 'file:src/app.ts')
    if (surface === 'terminal') expect((await ui.find({ key: 'filerow:src/app.ts' }))?.text.startsWith('▾ M src/app.ts')).toBe(true)
    else expect((await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.alt === 'Open')).toHaveLength(1)
    expect((await ui.find({ key: 'filediff:src/app.ts' }))?.text).toContain('Edit by builder')
    await press(ui, 'file:src/app.ts')
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

/** A Button's children, as the drawing holds them: none for a Button of a label alone. */
function childrenOf(node: { children?: unknown[] } | undefined): unknown[] {
  return node?.children ?? []
}

test('a press anywhere on a row of Changes opens or shuts it, not on its name alone: the terminal`s row one Button holding its chevron, code, path, faces, +a −r and names; a desktop`s a veil over the whole row (its icons and faces images no Button can hold), its name`s Button kept', async ($, on) => {
  const session = v2Session()
  const state = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  await demo($, on, state)
  const limiter = 'src/rateLimit.ts'
  const commit = state.changes.commits[0]!
  const outside = state.changes.edits.find(edit => edit.isOutside)!.path
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:changes')
    const fileButton = await ui.find({ key: `file:${limiter}` })
    if (surface === 'terminal') {
      // one Button the whole row: what it holds is all the row says, its faces the terminal's glyphs
      expect(fileButton?.props).toMatchObject({ label: limiter, plain: true })
      expect(childrenOf(fileButton).length).toBeGreaterThan(1)
      expect(fileButton?.text).toBe((await ui.find({ key: `filerow:${limiter}` }))?.text)
      expect(fileButton?.text).toMatch(/^▸ N src\/rateLimit\.ts .+ \+6 builder, tester$/)
      expect(await ui.find({ key: `row:file:${limiter}` })).toBeUndefined()
      // the commits' and the outside edits' rows too
      expect((await ui.find({ key: `commit:${commit.hash}` }))?.text).toBe((await ui.find({ key: `commit:${commit.hash}:row` }))?.text)
      expect((await ui.find({ key: `commit:${commit.hash}` }))?.text).toMatch(new RegExp(`^${commit.short} Add the sliding-window limiter builder · `))
      expect((await ui.find({ key: `edits:${outside}` }))?.text).toBe((await ui.find({ key: `editrow:${outside}` }))?.text)
      expect((await ui.find({ key: `edits:${outside}` }))?.text).toContain('1 edit +3')
    } else {
      // the name's Button stays (the keyboard's), and a blank plain Button lies over the whole row, its last part, placed at its four edges
      expect(fileButton?.props).toMatchObject({ label: limiter, plain: true })
      const veil = await ui.find({ key: `row:file:${limiter}` })
      expect(veil?.props.plain).toBe(true)
      expect(String(veil?.props.label).trim()).toBe('')
      const row = (await ui.find({ key: `filerow:${limiter}` })) as unknown as { children: { props: Record<string, unknown> }[] }
      expect(row.children.at(-1)?.props).toMatchObject({ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, overflow: 'hidden' })
      for (const key of [`row:commit:${commit.hash}`, `row:edits:${outside}`]) expect((await ui.find({ key }))?.props.plain).toBe(true)
    }
    // a press on the row opens it as a press on its name does, and shuts it again
    const rowKey = surface === 'terminal' ? `file:${limiter}` : `row:file:${limiter}`
    expect(await ui.find({ key: `filediff:${limiter}` })).toBeUndefined()
    await press(ui, rowKey)
    expect((await ui.find({ key: `filediff:${limiter}` }))?.text).toContain('Write by builder')
    await press(ui, rowKey)
    expect(await ui.find({ key: `filediff:${limiter}` })).toBeUndefined()
    // the edits outside the repository and the commits, the same
    const editKey = surface === 'terminal' ? `edits:${outside}` : `row:edits:${outside}`
    const before = (await ui.find({ key: `edited:${outside}` }))?.text ?? ''
    await press(ui, editKey)
    expect((await ui.find({ key: `edited:${outside}` }))?.text).not.toBe(before)
    await press(ui, editKey)
    expect((await ui.find({ key: `edited:${outside}` }))?.text).toBe(before)
    await press(ui, surface === 'terminal' ? `commit:${commit.hash}` : `row:commit:${commit.hash}`)
    expect((await ui.find({ key: `commit:${commit.hash}:row` }))?.text).toContain('The sample holds no commit of its own to read.')
    await press(ui, surface === 'terminal' ? `commit:${commit.hash}` : `row:commit:${commit.hash}`)
    expect((await ui.find({ key: `commit:${commit.hash}:row` }))?.text).not.toContain('The sample holds no commit')
    // the veils keep the drawing inside the desktop's bounds
    expect(nodesOf(await ui.drawn())).toBeLessThan(2000)
    await press(ui, 'tab:now')
    await ui.unmount()
  }
  // a veil is the desktop's alone: VS Code places no Box absolutely, so it draws none there
  const vscode = await $.ui.mount({ ...pane('desktop'), surface: 'vscode' as const })
  await press(vscode, 'tab:changes')
  expect((await vscode.findAll({ type: 'Button' })).filter(button => (button.key ?? '').startsWith('row:'))).toEqual([])
  await vscode.unmount()
})

test('the page`s selectRepo: a pick the state offers pins Changes there, acked "Changes shows <name>", and "" follows the work again; a root it does not offer is refused and changes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // /work holds two repositories and a folder that is none; git answers by where it runs
  const w = newWorld({
    git: (argv, cwd = '') => {
      const at = cwd.replace(/\\/g, '/')
      const root = ['/work/proj', '/work/site'].find(one => at === one || at.startsWith(`${one}/`))
      const line = argv.join(' ')
      if (!root) return { exitCode: 128, stdout: '' }
      if (line.includes('rev-parse --show-toplevel')) return { exitCode: 0, stdout: `${root}\n` }
      if (line.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: 'main\n' }
      if (line.includes('status --porcelain')) return { exitCode: 0, stdout: ' M app.ts\0' }
      if (line.includes('--numstat')) return { exitCode: 0, stdout: '1\t0\tapp.ts\0' }
      return { exitCode: 1, stdout: '' }
    },
    stat: path => (/[\\/]\.git$/.test(path) ? (/[\\/](proj|site)[\\/]\.git$/.test(path) ? { size: 0, mtimeMs: path.includes('site') ? NOW : NOW - 60_000 } : null) : { size: 12, mtimeMs: NOW }),
    // the engine resolves /work to C:\work on Windows
    list: path => (path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '') === '/work' ? [{ name: 'proj', kind: 'dir' }, { name: 'site', kind: 'dir' }, { name: 'notes', kind: 'dir' }] : null),
  })
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('web'))
  await clock.advance(1000)
  const v2 = () => (lastState(w) as unknown as { v2: W.WebStateV2 }).v2
  expect(v2().changes.repo).toBeNull()
  expect(v2().changes.where).toEqual({ cwd: '/work', name: 'work', isRepo: false, pinned: '', picks: [{ name: 'site', root: '/work/site' }, { name: 'proj', root: '/work/proj' }] })

  command(w.children[0], { cmd: 'selectRepo', id: 'rp-1', root: '/work/proj' })
  await clock.settle()
  await clock.advance(1000)
  expect(v2().acks.find(one => one.id === 'rp-1')).toMatchObject({ ok: true, status: 'delivered', text: 'Changes shows proj' })
  expect(v2().changes.repo).toMatchObject({ name: 'proj', root: '/work/proj', branch: 'main' })
  expect(v2().changes.where?.pinned).toBe('/work/proj')
  expect(v2().changes.files.map(file => file.path)).toEqual(['app.ts'])

  command(w.children[0], { cmd: 'selectRepo', id: 'rp-2', root: '/etc' })
  await clock.settle()
  await clock.advance(1000)
  expect(v2().acks.find(one => one.id === 'rp-2')).toMatchObject({ ok: false, status: 'failed', text: 'Not a repository Changes offers here' })
  expect(v2().changes.where?.pinned).toBe('/work/proj')

  command(w.children[0], { cmd: 'selectRepo', id: 'rp-3', root: '' })
  await clock.settle()
  await clock.advance(1000)
  expect(v2().acks.find(one => one.id === 'rp-3')).toMatchObject({ ok: true, status: 'delivered', text: 'Changes follows the work again' })
  expect(v2().changes.repo).toBeNull()
  expect(v2().changes.where?.pinned).toBe('')

  // the route the mod reads it by
  expect(W.routeOf({ cmd: 'selectRepo', root: ' /work/proj ' }, M.emptyData(0))).toEqual({ kind: 'selectRepo', root: '/work/proj' })
  expect(W.routeOf({ cmd: 'selectRepo', root: 7 }, M.emptyData(0))).toBeNull()
  expect(W.routeOf({ cmd: 'selectRepo', root: 'x'.repeat(1001) }, M.emptyData(0))).toBeNull()
  expect(W.refusalOf({ cmd: 'selectRepo' }, M.emptyData(0))).toBe('Not a repository Changes offers here')
})
