import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as R from '../hooks/repos'
import { gitWhere, isConfigList, posixTest, windowsTest } from './tools'

const HASH = 'b'.repeat(40)
const NOW = 1_700_000_100_000

const PANE = {
  title: 'Apiarius',
  isFocused: true,
  bodyColumns: 96,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

const VIEWPORT = { columns: 100, rows: 50, isFullscreen: true }

/** /apiarius as typed at the prompt, with what the engine stamps on it. */
function deck(args: string) {
  return { command: 'apiarius', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 100 } }
}

/** The repositories on this make-believe disk, by root as git prints it: branch, and what status and numstat print there. */
const DISK: Record<string, { branch: string; status: string; numstat: string }> = {
  '/repo': { branch: 'main', status: ' M src/app.ts\0?? notes.txt\0', numstat: '1\t1\tsrc/app.ts\0' },
  '/other': { branch: 'dev', status: ' M lib/x.ts\0', numstat: '3\t0\tlib/x.ts\0' },
  'C:/Users/Me/proj': { branch: 'trunk', status: ' M src/app.ts\0', numstat: '1\t1\tsrc/app.ts\0' },
  'C:/Users/Me/Documents/apiarius': { branch: 'main', status: ' M hooks/repos.ts\0', numstat: '2\t1\thooks/repos.ts\0' },
  'C:/Users/Me/Documents/site': { branch: 'main', status: ' M index.html\0', numstat: '1\t1\tindex.html\0' },
  '/home/me/Documents/apiarius': { branch: 'main', status: ' M hooks/repos.ts\0', numstat: '2\t1\thooks/repos.ts\0' },
  '/home/me/Documents/site': { branch: 'main', status: ' M index.html\0', numstat: '1\t1\tindex.html\0' },
}

/** A session's directory as the test lays it out: its children by name (a dot in one names a file), and the `.git` of each that holds one, with when it last changed. */
type Folder = { dir: string; children: string[]; gits: Record<string, number> }

/** Paths compare as the disk they name does: any case under a drive letter. */
function isSame(a: string, b: string): boolean {
  return /^[a-z]:/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** What git prints for `argv` run in `cwd`: the top level anywhere inside a repository, the rest at its root alone. */
function gitAt(argv: readonly string[], cwd: string): { exitCode: number; stdout: string } {
  const line = argv.join(' ')
  if (isConfigList(argv)) return { exitCode: 0, stdout: '' }
  const at = cwd.replace(/\\/g, '/')
  const root = Object.keys(DISK).find(one => isSame(at, one) || isSame(at.slice(0, one.length + 1), `${one}/`))
  if (!root) return { exitCode: 128, stdout: '' }
  if (line.includes('rev-parse --show-toplevel')) return { exitCode: 0, stdout: `${root}\n` }
  if (at !== root) return { exitCode: 128, stdout: '' }

  const repo = DISK[root]!
  if (line.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: `${repo.branch}\n` }
  if (line.includes('rev-parse --verify --quiet HEAD')) return { exitCode: 0, stdout: `${HASH}\n` }
  if (line.includes('@{upstream}')) return { exitCode: 128, stdout: '' }
  if (line.includes('status --porcelain')) return { exitCode: 0, stdout: repo.status }
  if (line.includes('--numstat -z HEAD')) return { exitCode: 0, stdout: repo.numstat }
  if (line.includes('rev-list --count')) return { exitCode: 0, stdout: '1\n' }
  if (line.includes(' log --since')) return { exitCode: 0, stdout: '\x1e\n 1 file changed, 2 insertions(+)\n' }
  if (line.includes(' log -n30')) return { exitCode: 0, stdout: `\x1e${HASH}\x1f${HASH.slice(0, 7)}\x1fSam\x1f1700000000\x1fFirst commit\n\n 1 file changed, 2 insertions(+)\n` }
  return { exitCode: 1, stdout: '' }
}

type Run = { line: string; cwd: string }

/** Answers every engine call the deck makes, git by argv and working directory, each run noted in `runs`; `folder` the one directory listed (each listing noted in `lists`), the `.git` of its repositories the only ones there. */
function world(on: On, runs: Run[], folder?: Folder, lists: string[] = []) {
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
  on('agent.list', () => ({ value: [] }))
  on('process.run', ($, e) => {
    const cwd = gitWhere(e)
    runs.push({ line: e.argv.join(' '), cwd })
    return { value: { ...gitAt(e.argv, cwd), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.stat', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (!path.endsWith('/.git')) return { value: { kind: 'file', size: 12, mtimeMs: NOW, isLink: false } }
    const parts = path.split('/').slice(0, -1)
    const name = parts.pop() ?? ''
    const at = folder && isSame(parts.join('/'), folder.dir) && Object.hasOwn(folder.gits, name) ? folder.gits[name] : undefined
    return at !== undefined ? { value: { kind: 'dir', size: 0, mtimeMs: at, isLink: false } } : { deny: 'no such file' }
  })
  on('fs.list', ($, e) => {
    lists.push(e.path)
    if (!folder || !isSame(e.path.replace(/\\/g, '/'), folder.dir)) return { deny: 'no such folder' }
    return { value: folder.children.map(name => ({ name, kind: /\.\w+$/.test(name) && !name.startsWith('.') ? ('file' as const) : ('dir' as const), size: 0, mtimeMs: 0, isLink: false })) }
  })
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

function edit(file: string) {
  return { tool: 'Edit' as const, file_path: file, old_string: 'const b = 2', new_string: 'const b = 3' }
}

function pane(surface: 'terminal' | 'desktop') {
  return { plugin: 'apiarius', surface, component: 'Pane' as const, requestId: 'apiarius', viewport: VIEWPORT, props: PANE }
}

const isProbe = (run: Run) => run.line.includes('rev-parse --show-toplevel')

/** A read of where git's settings come from, which the deck makes before each run, there (`isConfigList`). */
const isConfig = (run: Run) => isConfigList(run.line.split(' '))

/** Whether git changed to each folder itself (`-C`, never started there), and each run came with a read of where git's settings come from in its folder (one that reads the working tree with another after it). */
function isEachReadFirst(runs: readonly Run[]): boolean {
  const count = (some: readonly Run[], folder: string) => some.filter(run => run.cwd === folder).length
  const reads = runs.filter(run => run.line.includes(' config --list --show-scope'))
  const others = runs.filter(run => !isConfig(run))
  return runs.every(run => run.line.startsWith('git -C ')) && others.every(run => count(reads, run.cwd) >= count(others, run.cwd))
}

test('a session outside any repository follows the one an agent edits: its files on each surface, git run at its root', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const runs: Run[] = []
  world(on, runs)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/notes' })
  await $.command.run(deck('changes'))
  await $.tool.call(edit('/repo/src/app.ts'))
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ key: 'file:src/app.ts' })).toBeDefined()
    expect(await ui.find({ key: 'file:notes.txt' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /not a git repository/ })).toBeUndefined()
    await ui.unmount()
  }

  // each directory is probed once: the session's, then the edited file's
  expect(runs.filter(isProbe).map(run => run.cwd)).toEqual(['/notes', '/repo/src'])
  // and every other git command ran at the root git printed
  const rest = runs.filter(run => !isProbe(run) && !isConfig(run))
  expect(isEachReadFirst(runs)).toBe(true)
  expect(rest.some(run => run.line.includes('status --porcelain'))).toBe(true)
  expect(rest.filter(run => run.cwd !== '/repo')).toEqual([])
})

test('the deck follows the repository edited last', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const runs: Run[] = []
  world(on, runs)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('changes'))
  await $.tool.call(edit('/repo/src/app.ts'))
  await clock.advance(1000)

  const before = await $.ui.mount(pane('terminal'))
  expect(await before.find({ key: 'file:src/app.ts' })).toBeDefined()
  await before.unmount()

  await $.tool.call(edit('/other/lib/x.ts'))
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ key: 'file:lib/x.ts' })).toBeDefined()
    expect(await ui.find({ key: 'file:src/app.ts' })).toBeUndefined()
    await ui.unmount()
  }

  expect(runs.filter(isProbe).map(run => run.cwd)).toEqual(['/repo', '/repo/src', '/other/lib'])
  const statusAt = runs.filter(run => run.line.includes('status --porcelain')).map(run => run.cwd)
  expect(statusAt[0]).toBe('/repo')
  expect(statusAt[statusAt.length - 1]).toBe('/other')
})

test('Windows spellings: a backslashed path in any case finds the root git prints with forward slashes, probed once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const runs: Run[] = []
  world(on, runs)

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:\\Users\\Me\\Documents' })
  await $.command.run(deck('changes'))
  await $.tool.call(edit('C:\\Users\\Me\\proj\\src\\app.ts'))
  await $.tool.call(edit('c:\\users\\me\\PROJ\\src\\util.ts'))
  await clock.advance(1000)
  await $.tool.call(edit('C:\\USERS\\Me\\proj\\src\\app.ts'))
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ key: 'file:src/app.ts' })).toBeDefined()
    await ui.unmount()
  }

  expect(runs.filter(isProbe).map(run => run.cwd)).toEqual(['C:\\Users\\Me\\Documents', 'C:/Users/Me/proj/src'])
  expect(runs.filter(run => !isProbe(run) && !isConfig(run) && run.cwd !== 'C:/Users/Me/proj')).toEqual([])
})

/** The picks Changes offers, by their Buttons' keys in the order drawn. */
async function picksOf(ui: { findAll: (q: { type: 'Button' }) => Promise<{ key?: string }[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith('changes:pick:'))
}

/** A chat's Documents folder, as the deck cleans it (`dir`) and as the host spells it (`native`), with the host's separator. */
type Documents = { dir: string; native: string; sep: '\\' | '/' }

const WINDOWS_DOCUMENTS: Documents = { dir: 'C:/Users/Me/Documents', native: 'C:\\Users\\Me\\Documents', sep: '\\' }
const POSIX_DOCUMENTS: Documents = { dir: '/home/me/Documents', native: '/home/me/Documents', sep: '/' }

const NEARBY = 'a chat in a directory that is no repository says so, naming it, and offers the repositories directly inside it (looked for once, no git run, the one changed last first, at most 8); a pick pins Changes there, Follow the work lets go, and an agent`s edit is followed'

/** NEARBY's run, the chat in the Documents folder `at`. */
async function nearby($: Engine, on: On, at: Documents) {
  const clock = mock.clock(on, { now: NOW })
  const runs: Run[] = []
  const lists: string[] = []
  const repos = ['apiarius', 'site', ...Array.from({ length: 8 }, (_, i) => `old${i}`)]
  const folder: Folder = {
    dir: at.dir,
    children: ['notes', ...repos, '.config', 'node_modules', 'todo.md'],
    // a hidden folder and node_modules are not looked into, whatever they hold
    gits: { ...Object.fromEntries(repos.map((name, i) => [name, NOW - (i + 1) * 60_000])), '.config': NOW, node_modules: NOW },
  }
  world(on, runs, folder, lists)

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: at.native })
  await $.command.run(deck('changes'))
  await clock.advance(1000)

  const offered = ['apiarius', 'site', 'old0', 'old1', 'old2', 'old3', 'old4', 'old5'].map(name => `changes:pick:${at.dir}/${name}`)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'changes:repo' }))?.text).toBe('This chat runs in Documents, which isn’t a git repository. Changes follows the repository an agent edits in.')
    expect((await ui.find({ key: 'changes:picks' }))?.text).toContain('REPOSITORIES IN DOCUMENTS')
    expect(await picksOf(ui)).toEqual(offered)
    expect((await ui.find({ key: offered[0]! }))?.props.label).toBe('apiarius')
    expect(await ui.find({ key: 'changes:follow' })).toBeUndefined()
    await ui.unmount()
  }
  // looked for once, by a listing and a stat a child: git runs in none of them
  await clock.advance(120_000)
  expect(lists).toEqual([at.native])
  expect(runs.filter(run => run.cwd !== at.native)).toEqual([])

  // a pick: the usual git view of it, pinned, with a quiet way back
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: offered[0]! })
  await clock.advance(1000)
  await ui.redraw()
  const line = (await ui.find({ key: 'changes:repo' }))?.text ?? ''
  expect(line).toContain('apiarius ⎇ main')
  expect(line).toContain('· pinned ·')
  expect(await ui.find({ key: 'file:hooks/repos.ts' })).toBeDefined()
  expect((await ui.find({ key: 'changes:follow' }))?.props).toMatchObject({ label: 'Follow the work', plain: true, dimColor: true })
  expect(await picksOf(ui)).toEqual([])
  expect(runs.some(run => run.cwd === `${at.dir}/apiarius` && run.line.includes('status --porcelain'))).toBe(true)

  // Follow the work: the pin let go, the picks again
  await ui.press({ key: 'changes:follow' })
  await clock.advance(1000)
  await ui.redraw()
  expect((await ui.find({ key: 'changes:repo' }))?.text).toContain('This chat runs in Documents')
  expect(await picksOf(ui)).toEqual(offered)

  // an agent edits in one of them: Changes follows it, no pin to let go
  await $.tool.call(edit([at.native, 'site', 'index.html'].join(at.sep)))
  await clock.advance(1000)
  await ui.redraw()
  expect((await ui.find({ key: 'changes:repo' }))?.text).toContain('site ⎇ main')
  expect((await ui.find({ key: 'changes:repo' }))?.text).not.toContain('pinned')
  expect(await ui.find({ key: 'changes:follow' })).toBeUndefined()
  expect(await ui.find({ key: 'file:index.html' })).toBeDefined()
  await ui.unmount()
  expect(lists).toEqual([at.native])
}

windowsTest(NEARBY, ($, on) => nearby($, on, WINDOWS_DOCUMENTS))

posixTest(`${NEARBY}, on Linux and macOS`, ($, on) => nearby($, on, POSIX_DOCUMENTS))

test('repos: a session`s directory in no repository is looked into once for the repositories directly inside it, the one changed last first, at most 8; one in a repository offers none', async () => {
  const book = R.emptyBook('C:\\Users\\Me\\Documents')
  // not probed yet: nothing to look for
  expect(R.needsNearby(book)).toBe(false)
  R.settle(book, R.probesOf(book)[0]!, null)
  expect(R.needsNearby(book)).toBe(true)
  expect(R.nearbyOf(book)).toEqual([])

  // only directories, none hidden, no node_modules
  const entries = [
    { name: 'apiarius', kind: 'dir' },
    { name: '.git', kind: 'dir' },
    { name: 'node_modules', kind: 'dir' },
    { name: 'todo.md', kind: 'file' },
    { name: 'link', kind: 'other' },
    { name: 'site', kind: 'dir' },
  ]
  expect(R.childDirsOf(entries)).toEqual(['apiarius', 'site'])
  expect(R.childDirsOf(Array.from({ length: 300 }, (_, i) => ({ name: `d${i}`, kind: 'dir' })))).toHaveLength(R.MOST_LOOKED)

  const found = [{ name: 'site', changedAt: 5 }, { name: 'apiarius', changedAt: 9 }, ...Array.from({ length: 9 }, (_, i) => ({ name: `z${i}`, changedAt: 1 }))]
  R.settleNearby(book, book.cwd, found)
  expect(R.needsNearby(book)).toBe(false)
  expect(R.nearbyOf(book)).toHaveLength(R.MOST_NEARBY)
  expect(R.nearbyOf(book).slice(0, 4)).toEqual([
    { root: 'C:/Users/Me/Documents/apiarius', name: 'apiarius' },
    { root: 'C:/Users/Me/Documents/site', name: 'site' },
    { root: 'C:/Users/Me/Documents/z0', name: 'z0' },
    { root: 'C:/Users/Me/Documents/z1', name: 'z1' },
  ])

  // another directory is looked into anew; one inside a repository offers none
  R.setCwd(book, 'C:/Users/Me/Documents/apiarius')
  expect(R.nearbyOf(book)).toEqual([])
  R.settle(book, R.probesOf(book)[0]!, 'C:/Users/Me/Documents/apiarius')
  expect(R.needsNearby(book)).toBe(false)
  expect(R.nearbyOf(book)).toEqual([])
  // the same directory spelled another way needs no second look
  R.setCwd(book, 'c:\\users\\me\\documents')
  R.settle(book, R.probesOf(book)[0]!, null)
  expect(R.needsNearby(book)).toBe(false)
  expect(R.nearbyOf(book)).toHaveLength(R.MOST_NEARBY)
})

test('repos: paths compare as Windows spells them, git output is cut to its line', async () => {
  expect(R.dirOf('C:\\Users\\Me\\proj\\src\\app.ts')).toBe('C:/Users/Me/proj/src')
  expect(R.dirOf('/repo/src/app.ts')).toBe('/repo/src')
  expect(R.dirOf('C:\\boot.ini')).toBe('C:/')
  expect(R.dirOf('/init')).toBe('/')
  expect(R.dirOf('notes.md')).toBe('.')

  expect(R.rootOf('C:/Users/Me/proj\n')).toBe('C:/Users/Me/proj')
  expect(R.rootOf('/repo\r\n')).toBe('/repo')
  expect(R.rootOf('/\n')).toBe('/')
  expect(R.rootOf('\n')).toBe('')
  expect(R.rootOf('')).toBe('')

  expect(R.sameRoot('C:\\Users\\Me\\Proj\\', 'c:/users/me/proj')).toBe(true)
  expect(R.sameRoot('/Repo', '/repo')).toBe(false)
  expect(R.sameRoot('', '')).toBe(true)
  expect(R.cleanPath('C:\\')).toBe('C:/')
  expect(R.isAbsolute('C:\\x')).toBe(true)
  expect(R.isAbsolute('/x')).toBe(true)
  expect(R.isAbsolute('src/x.ts')).toBe(false)
})

test('repos: each directory is probed once, and the deck follows the pin, else the last edit, else the session', async () => {
  const book = R.emptyBook('C:\\Users\\Me\\Documents')
  expect(R.probesOf(book)).toEqual([{ kind: 'cwd', dir: 'C:\\Users\\Me\\Documents' }])
  R.settle(book, { kind: 'cwd', dir: 'C:\\Users\\Me\\Documents' }, null)
  expect(book.cwdRoot).toBe('')
  expect(R.activeRoot(book)).toBe('')
  expect(R.repoList(book)).toEqual([])

  R.noteEdit(book, 'C:\\Users\\Me\\proj\\src\\app.ts', 100)
  R.noteEdit(book, 'c:/users/me/PROJ/src/util.ts', 200)
  const probes = R.probesOf(book)
  expect(probes).toEqual([{ kind: 'dir', dir: 'C:/Users/Me/proj/src' }])
  R.settle(book, probes[0]!, R.rootOf('C:/Users/Me/proj\n'))
  expect(R.probesOf(book)).toEqual([])
  expect(R.activeRoot(book)).toBe('C:/Users/Me/proj')
  expect(R.repoList(book)).toEqual([{ root: 'C:/Users/Me/proj', name: 'proj', lastEditAt: 200, isCwd: false }])

  // the same directory spelled another way, and the session's own, need no probe
  R.noteEdit(book, 'C:\\USERS\\me\\proj\\src\\more.ts', 300)
  R.noteEdit(book, 'C:\\Users\\Me\\Documents\\todo.md', 400)
  expect(R.probesOf(book)).toEqual([])
  expect(R.repoList(book)[0]?.lastEditAt).toBe(300)

  // a repository edited later takes over; a pin wins over both, and unpinned the last edit leads again
  R.noteEdit(book, 'D:\\work\\api\\main.go', 500)
  R.settle(book, R.probesOf(book)[0]!, 'D:/work/api')
  expect(R.activeRoot(book)).toBe('D:/work/api')
  book.pinned = 'c:/users/me/proj'
  expect(R.activeRoot(book)).toBe('C:/Users/Me/proj')
  book.pinned = ''
  expect(R.activeRoot(book)).toBe('D:/work/api')

  // the session's repository leads only while no repository has an edit
  const site = R.emptyBook('/home/me/site')
  R.settle(site, R.probesOf(site)[0]!, '/home/me/site')
  expect(R.activeRoot(site)).toBe('/home/me/site')
  R.noteEdit(site, '/srv/b/x.ts', 5)
  R.noteEdit(site, '/srv/a/y.ts', 9)
  for (const probe of R.probesOf(site)) R.settle(site, probe, probe.dir)
  expect(R.repoList(site).map(repo => [repo.name, repo.lastEditAt, repo.isCwd])).toEqual([
    ['a', 9, false],
    ['b', 5, false],
    ['site', 0, true],
  ])
  expect(R.activeRoot(site)).toBe('/srv/a')

  // a new working directory is probed anew; the same one is not
  R.setCwd(site, '/home/me/site')
  expect(R.probesOf(site)).toEqual([])
  R.setCwd(site, '/home/me/blog')
  expect(R.probesOf(site)).toEqual([{ kind: 'cwd', dir: '/home/me/blog' }])
})

test('repos: a pin resolves to its root or is dropped, and a repository that is gone is forgotten', async () => {
  const book = R.emptyBook('/notes')
  R.settle(book, R.probesOf(book)[0]!, null)

  book.pinned = '/gone'
  expect(R.probesOf(book)).toEqual([{ kind: 'pin', dir: '/gone' }])
  R.settle(book, { kind: 'pin', dir: '/gone' }, null)
  expect(book.pinned).toBe('')

  book.pinned = '/repo/src'
  R.settle(book, R.probesOf(book)[0]!, '/repo')
  expect(book.pinned).toBe('/repo')
  expect(R.probesOf(book)).toEqual([])
  expect(R.lookup(book, '/repo/src')).toBe('/repo')
  expect(R.lookup(book, '/repo/')).toBe('/repo')
  expect(R.lookup(book, '/notes')).toBeNull()
  expect(R.lookup(book, '/elsewhere')).toBeUndefined()

  // a probe the person moved past since fills the cache and changes no pin
  book.pinned = '/other'
  R.settle(book, { kind: 'pin', dir: '/repo/lib' }, '/repo')
  expect(book.pinned).toBe('/other')
  book.pinned = '/repo'

  R.dropRepo(book, '/repo')
  expect(book.pinned).toBe('')
  expect(R.lookup(book, '/repo/src')).toBeUndefined()
  expect(R.repoList(book)).toEqual([])
  expect(R.activeRoot(book)).toBe('')
})

test('repos: display paths move to the new root, and the old root is read off the edits', async () => {
  expect(R.rerootPath('src/app.ts', '/repo', '/other')).toBe('/repo/src/app.ts')
  expect(R.rerootPath('/other/lib/x.ts', '/repo', '/other')).toBe('lib/x.ts')
  expect(R.rerootPath('src/app.ts', '/repo', '')).toBe('/repo/src/app.ts')
  expect(R.rerootPath('src/app.ts', '/repo', '/repo')).toBe('src/app.ts')
  expect(R.rerootPath('C:/Users/Me/proj/src/app.ts', '', 'c:/users/me/proj')).toBe('src/app.ts')
  expect(R.rerootPath('x.ts', 'C:/', 'C:/Users')).toBe('C:/x.ts')
  expect(R.rerootPath('src/app.ts', '', '/repo')).toBe('src/app.ts')

  expect(R.rootOfEdits([{ path: '/abs/x.ts', abs: '/abs/x.ts' }, { path: 'src/app.ts', abs: '/repo/src/app.ts' }])).toBe('/repo')
  expect(R.rootOfEdits([{ path: 'src/app.ts', abs: 'c:/users/me/proj/SRC/app.ts' }])).toBe('c:/users/me/proj')
  expect(R.rootOfEdits([{ path: 'x.ts', abs: 'C:/x.ts' }])).toBe('C:/')
  expect(R.rootOfEdits([{ path: 'repo/x.ts', abs: '/repo/x.ts' }])).toBe('/')
  expect(R.rootOfEdits([])).toBe('')
})
