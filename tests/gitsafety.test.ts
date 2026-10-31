/**
 * Git that runs nothing a repository's own settings name (hooks/git.ts),
 * pure and through the deck: every command's own guards, the repository's
 * settings read before each run there (`repoConfigOf`: its filter drivers
 * off, the person's own set back), a repository that defines one the
 * command line cannot name refused, git started in the session's folder
 * (`-C`), names a repository chose shown safely. tests/gitpoc.test.mjs runs
 * the same against real git and hostile repositories.
 */
import { expect, mock, test } from 'claude-code/testing'

import * as F from '../hooks/format'
import * as G from '../hooks/git'
import * as W from '../hooks/web'
import { isConfigList } from './tools'
import { deck, newWorld, NOW, world } from './world'

/** `git config --list --show-scope -z` as git prints it: each setting's scope, a NUL, its key, a newline and its value, a NUL. */
function listing(...settings: [scope: string, key: string, value?: string][]): string {
  return settings.map(([scope, key, value]) => `${scope}\0${key}${value === undefined ? '' : `\n${value}`}\0`).join('')
}

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

test('every command the deck runs carries its own guards: no file-system monitor, signature check, submodule`s git or remote; every one that diffs no external diff or text conversion; status none of a submodule`s', () => {
  const all = [
    G.argv.toplevel,
    G.argv.branch,
    G.argv.head,
    G.argv.upstream,
    G.argv.aheadBehind,
    G.argv.status,
    G.argv.numstat('HEAD'),
    G.argv.fileDiff('HEAD', ['a.ts']),
    G.argv.log(30),
    G.argv.countSince('midnight'),
    G.argv.statSince('midnight'),
    G.argv.showMeta('abc1234'),
    G.argv.showNumstat('abc1234'),
    G.argv.showPatch('abc1234'),
    G.argv.newSince('abc1234'),
    G.argv.recentHashes,
    G.argv.config,
  ]
  for (const argv of all) {
    const line = argv.join(' ')
    for (const guard of ['--no-optional-locks', '-c core.fsmonitor= ', '-c log.showSignature=false', '-c submodule.recurse=false', '-c diff.submodule=short', '-c protocol.allow=never', '-c protocol.file.allow=never', '-c protocol.ssh.allow=never', '-c protocol.ext.allow=never']) expect([line, line.includes(guard)]).toEqual([line, true])
  }
  for (const argv of [G.argv.numstat('HEAD'), G.argv.fileDiff('HEAD', []), G.argv.log(30), G.argv.statSince('midnight'), G.argv.showMeta('abc1234'), G.argv.showNumstat('abc1234'), G.argv.showPatch('abc1234')]) {
    for (const flag of ['--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty']) expect(argv).toContain(flag)
  }
  expect(G.argv.status).toContain('--ignore-submodules=dirty')
  expect(G.GIT_ENV.GIT_NO_LAZY_FETCH).toBe('1')
  // run from the session's own folder: git changes to the repository itself, the overrides before its own options
  expect(G.argvIn(G.argv.status, '/r/x', ['-c', 'filter.evil.clean='])).toEqual(['git', '-C', '/r/x', '-c', 'filter.evil.clean=', ...G.argv.status.slice(1)])
  // show is handed a commit's name as git prints one, never an option
  expect(['abc1234', 'a'.repeat(40), 'ABCDEF12'].every(G.isHash)).toBe(true)
  expect(['', 'abc', '--output=/tmp/x', '-p', 'HEAD', 'a'.repeat(65), 'abc 123'].some(G.isHash)).toBe(false)
})

test('a repository`s own filter drivers: each switched off, required no more; the person`s own by that name set back to theirs; one of theirs given a process of the repository`s, which git runs first, off; none of theirs touched where the repository says nothing; a name the command line cannot carry refused', () => {
  expect(G.repoConfigOf('')).toEqual({ overrides: [], drivers: [] })
  // the person's lfs, which the repository names in its attributes and leaves be: nothing to say
  const lfs: [string, string, string][] = [
    ['global', 'filter.lfs.clean', 'git-lfs clean -- %f'],
    ['global', 'filter.lfs.smudge', 'git-lfs smudge -- %f'],
    ['global', 'filter.lfs.process', 'git-lfs filter-process'],
    ['global', 'filter.lfs.required', 'true'],
  ]
  expect(G.repoConfigOf(listing(...lfs, ['local', 'core.bare', 'false']))).toEqual({ overrides: [], drivers: [] })
  // its own drivers, from its config, its worktree's, a file it includes (git says local), an unknown source
  const own = G.repoConfigOf(
    listing(
      ...lfs,
      ['local', 'filter.evil.clean', 'touch /tmp/pwned'],
      ['local', 'filter.evil.required', 'true'],
      ['worktree', 'filter.wt.process', 'touch /tmp/pwned'],
      ['unknown', 'filter.git-crypt.smudge', 'git-crypt smudge'],
      ['local', 'filter.lfs.clean', 'touch /tmp/pwned'],
      ['local', 'diff.evil.textconv', 'touch /tmp/pwned'],
    ),
  )
  expect(own).toEqual({
    overrides: [
      '-c', 'filter.evil.clean=', '-c', 'filter.evil.required=false',
      '-c', 'filter.git-crypt.smudge=', '-c', 'filter.git-crypt.required=false',
      '-c', 'filter.lfs.clean=git-lfs clean -- %f', '-c', 'filter.lfs.smudge=git-lfs smudge -- %f', '-c', 'filter.lfs.process=git-lfs filter-process', '-c', 'filter.lfs.required=true',
      '-c', 'filter.wt.process=', '-c', 'filter.wt.required=false',
    ],
    drivers: ['evil', 'git-crypt', 'wt'],
  })
  // the command line's own settings (Claude Code's, the deck's) are the person's
  expect(G.repoConfigOf(listing(['command', 'filter.x.clean', 'cat']))).toEqual({ overrides: [], drivers: [] })
  // the person's clean, the repository's process beside it: git would run the process, which can be blanked but not unset
  expect(G.repoConfigOf(listing(['global', 'filter.lfs.clean', 'cat'], ['local', 'filter.lfs.process', 'touch /tmp/pwned']))).toEqual({ overrides: ['-c', 'filter.lfs.clean=cat', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false'], drivers: ['lfs'] })
  // a name with an = or a space would be read as another setting: nothing runs there
  for (const name of ['a=b', 'a b', 'x\ty', '']) expect('refusal' in G.repoConfigOf(listing(['local', `filter.${name}.clean`, 'touch /tmp/pwned']))).toBe(name !== '')
  expect(G.configRefusalOf("error: unknown option `show-scope'\nusage: git config")).toContain('git 2.26 or newer')
  expect(G.configRefusalOf('fatal: bad config line 3 in file .git/config\n')).toBe('fatal: bad config line 3 in file .git/config')
})

test('names a repository chose, as git prints them: a path`s control characters and bidirectional controls each U+FFFD, a commit`s author, subject and message the same, its message`s lines kept', () => {
  expect(G.shownOf('src/a\u001b[31mb\u009b.ts')).toBe('src/a�[31mb�.ts')
  expect(G.shownOf('invoice‮fdp.exe')).toBe('invoice�fdp.exe')
  // the marks too: left-to-right, right-to-left, the Arabic letter mark
  expect(G.shownOf('a\u200eb\u200fc\u061cd')).toBe('a�b�c�d')
  expect(F.oneLine('a\u200eb\u200fc\u061cd')).toBe('a�b�c�d')
  expect(G.parseStatus(' M ok.ts\0?? a\u0007b\0R  new\u0085.ts\0old⁦.ts\0')).toEqual([
    { x: ' ', y: 'M', path: 'ok.ts' },
    { x: '?', y: '?', path: 'a�b' },
    { x: 'R', y: ' ', path: 'new�.ts', oldPath: 'old�.ts' },
  ])
  expect(G.parseNumstat('1\t2\ta\u001bb\0').map(row => row.path)).toEqual(['a�b'])
  const [commit] = G.parseLog(`\x1e${'a'.repeat(40)}\x1faaaaaaa\x1fSam\u001b]0;x\u0007\x1f1700000000\x1fFix \u009b2J it\n\n 1 file changed, 2 insertions(+)\n`)
  expect(commit).toMatchObject({ author: 'Sam\ufffd]0;x\ufffd', subject: 'Fix \ufffd2J it' })
  expect(G.parseMeta(`${'a'.repeat(40)}\x1fSam\x1fsam@x\u001b\x1f1700000000\x1fLine one\u001b[2J\nLine\ttwo\u009b`)).toMatchObject({ email: 'sam@x\ufffd', body: 'Line one\ufffd[2J\nLine\ttwo\ufffd' })
})

/** A repository at /work (the session's own folder), git's answers there; the commands the deck ran, and the toasts it showed. */
function repoWorld(config: (cwd: string) => { exitCode: number; stdout: string; stderr?: string }, status = ' M app.ts\0') {
  const runs: string[][] = []
  const w = newWorld({
    gitConfig: config,
    git: (argv, cwd = '') => {
      runs.push([...argv])
      const line = argv.join(' ')
      if (cwd.replace(/\\/g, '/') !== '/work') return { exitCode: 128, stdout: '' }
      if (line.includes('rev-parse --show-toplevel')) return { exitCode: 0, stdout: '/work\n' }
      if (line.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: 'main\n' }
      if (line.includes('status --porcelain')) return { exitCode: 0, stdout: status }
      if (line.includes('--numstat')) return { exitCode: 0, stdout: status.includes('app.ts') ? '1\t0\tapp.ts\0' : '' }
      return { exitCode: 1, stdout: '' }
    },
  })
  return { w, runs }
}

test('through the deck: a repository whose own config defines a filter driver has it switched off in every git command run there (each run reading its settings first, there), and Changes says so once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const evil = listing(['local', 'filter.evil.clean', 'touch /tmp/pwned'])
  const { w, runs } = repoWorld(() => ({ exitCode: 0, stdout: evil }))
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('changes'))
  await clock.advance(1000)
  await clock.advance(7000)
  const ran = runs.filter(argv => !isConfigList(argv))
  expect(ran.some(argv => argv.includes('status'))).toBe(true)
  for (const argv of ran) {
    expect(argv.slice(0, 2)).toEqual(['git', '-C'])
    expect(argv.join(' ')).toContain('-c filter.evil.clean= -c filter.evil.required=false')
  }
  expect(w.toasts.filter(text => text.includes('own git filter (evil) off'))).toEqual(['Changes reads work with its own git filter (evil) off: files it handles may show as changed.'])
})

test('through the deck: a repository defining a filter whose name the command line cannot carry runs no git command, and says why once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const odd = listing(['local', 'filter.a=b.clean', 'touch /tmp/pwned'])
  const { w, runs } = repoWorld(() => ({ exitCode: 0, stdout: odd }))
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('changes'))
  await clock.advance(1000)
  await clock.advance(7000)
  expect(runs.filter(argv => !isConfigList(argv))).toEqual([])
  expect(w.toasts.filter(text => text.includes('cannot switch off'))).toEqual([`work: This repository's own git settings define a filter Apiarius cannot switch off ("a=b"), so it runs no git there.`])
})

test('through the deck: a git too old to say where its settings come from (before 2.26) runs no git command there, and says so once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { w, runs } = repoWorld(() => ({ exitCode: 129, stdout: '', stderr: "error: unknown option `show-scope'" }))
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('changes'))
  await clock.advance(1000)
  await clock.advance(7000)
  expect(runs.filter(argv => !isConfigList(argv))).toEqual([])
  expect(w.toasts.filter(text => text.includes('git 2.26 or newer')).length).toBe(1)
})

test('a repository`s attribute files, pure: every .gitattributes git lists (a folder it shows whole left out), each `filter=` a macro or a pattern starting with [ names, a core.attributesFile placed as git places it, the filter settings compared before and after a run, and which commands read the working tree', () => {
  expect(G.attrPlacesOf('.gitattributes\0sub/.gitattributes\0src/a.ts\0', 'ign/.gitattributes\0node_modules/\0sub/.gitattributes\0')).toEqual(['.gitattributes', 'sub/.gitattributes', 'ign/.gitattributes'])
  expect(G.attrFilterNamesOf(['[attr]m filter=macro\n* m\n', '[ab]*.txt filter=bracket\n# * filter=comment\n*.bin -filter !filter\n', 'x\tfilter=tab'])).toEqual(['macro', 'bracket', 'tab'])
  const named = (value: string) => listing(['local', 'core.attributesfile', value])
  expect(G.attributesFileOf(named('my.attrs'), '/r/x', '/home/me')).toBe('/r/x/my.attrs')
  expect(G.attributesFileOf(named('~/attrs'), '/r/x', '/home/me')).toBe('/home/me/attrs')
  expect(G.attributesFileOf(named('/etc/attrs'), '/r/x', '/home/me')).toBe('/etc/attrs')
  expect(G.attributesFileOf(named('C:/attrs'), '/r/x', '/home/me')).toBe('C:/attrs')
  expect(G.attributesFileOf(listing(['global', 'core.attributesfile', '~/mine']), '/r/x', '/home/me')).toBe('')
  for (const odd of ['~root/attrs', '%(prefix)/attrs']) expect(G.attributesFileOf(named(odd), '/r/x', '/home/me')).toHaveProperty('refusal')
  expect(G.attributesFileOf(named('~/attrs'), '/r/x', '')).toHaveProperty('refusal')
  // only the settings that decide which filter runs: a branch's upstream written meanwhile (git push -u) moves nothing
  const before = listing(['local', 'core.bare', 'false'], ['local', 'filter.lfs.clean', 'x'])
  expect(G.filterSettingsOf(before)).toBe(G.filterSettingsOf(`${before}${listing(['local', 'branch.main.remote', 'origin'])}`))
  expect(G.filterSettingsOf(before)).not.toBe(G.filterSettingsOf(`${before}${listing(['local', 'filter.evil.clean', 'touch /tmp/pwned'])}`))
  expect(G.filterSettingsOf(before)).not.toBe(G.filterSettingsOf(`${before}${listing(['local', 'core.attributesFile', 'x'])}`))
  expect([G.argv.status, G.argv.numstat('HEAD'), G.argv.fileDiff('HEAD', [])].every(G.readsWorktree)).toBe(true)
  expect([G.argv.log(30), G.argv.toplevel, G.argv.showPatch('abc1234'), G.argv.config, G.argv.attrFiles].some(G.readsWorktree)).toBe(false)
})

test('through the deck: before a command that reads the working tree, every filter any attribute file names is blanked (a nested one, a macro, an ignored one, info/attributes where git keeps it, a relative core.attributesFile, a tracked one gone from the working tree as the index holds it), each read through web/files.js; a command that reads no working tree reads none', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { w, runs } = repoWorld(() => ({ exitCode: 0, stdout: listing(['local', 'core.attributesfile', 'my.attrs']) }))
  w.gitAttrs = argv => {
    const line = argv.join(' ')
    if (line.includes('--ignored')) return { exitCode: 0, stdout: 'ign/.gitattributes\0node_modules/\0' }
    if (line.includes('ls-files')) return { exitCode: 0, stdout: '.gitattributes\0sub/.gitattributes\0gone/.gitattributes\0' }
    return { exitCode: 0, stdout: '.git/info/attributes\n' }
  }
  const git = w.git
  w.git = (argv, cwd) => (argv.join(' ').includes('cat-file blob :gone/.gitattributes') ? { exitCode: 0, stdout: '* filter=fromindex\n' } : (git?.(argv, cwd) ?? { exitCode: 1, stdout: '' }))
  w.onDisk = {
    '/work/.gitattributes': '[attr]m filter=macro\n* m\n',
    '/work/sub/.gitattributes': '* filter=nested\n',
    '/work/ign/.gitattributes': '* filter=ignored\n',
    '/work/.git/info/attributes': '* filter=info\n',
    '/work/my.attrs': '* filter=attrfile\n',
  }
  // gone/.gitattributes is in the index alone
  w.stat = path => (path.replace(/\\/g, '/') === '/work/gone/.gitattributes' ? null : { size: 12, mtimeMs: NOW })
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('changes'))
  await clock.advance(1000)
  const status = runs.find(argv => argv.includes('status'))?.join(' ') ?? ''
  for (const name of ['macro', 'nested', 'ignored', 'info', 'attrfile', 'fromindex']) expect([name, status.includes(`-c filter.${name}.clean= -c filter.${name}.smudge= -c filter.${name}.process= -c filter.${name}.required=false`)]).toEqual([name, true])
  const branch = runs.find(argv => argv.join(' ').includes('rev-parse --abbrev-ref HEAD'))?.join(' ') ?? ''
  expect(branch).not.toContain('filter.')
  expect(new Set(w.fileReads)).toEqual(new Set(['/work/.gitattributes', '/work/sub/.gitattributes', '/work/ign/.gitattributes', '/work/.git/info/attributes', '/work/my.attrs']))
})

for (const how of ['a link', 'one web/files.js refuses'] as const) {
  test(`through the deck: a repository whose attribute file is ${how} runs no command that reads its working tree, and says why once`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const { w, runs } = repoWorld(() => ({ exitCode: 0, stdout: '' }))
    w.gitAttrs = argv => (argv.join(' ').includes('ls-files') && !argv.includes('--ignored') ? { exitCode: 0, stdout: 'sub/.gitattributes\0' } : { exitCode: 0, stdout: '' })
    w.stat = path => (path.replace(/\\/g, '/') === '/work/sub/.gitattributes' ? { size: 12, mtimeMs: NOW, isLink: how === 'a link' } : { size: 12, mtimeMs: NOW })
    w.onDisk = { '/work/sub/.gitattributes': '* filter=evil\n' }
    w.safeRead = abs => (how !== 'a link' && abs === '/work/sub/.gitattributes' ? { kind: 'refused', why: 'a link on the way' } : undefined)
    world(on, w)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
    await $.command.run(deck('changes'))
    await clock.advance(1000)
    await clock.advance(7000)
    expect(runs.some(argv => argv.includes('status') || argv.includes('diff'))).toBe(false)
    expect(w.toasts.filter(text => text.includes('attribute file'))).toEqual([`work: This repository's attribute file "sub/.gitattributes" is a link, not a plain file, too big or unreadable, so Apiarius runs no git there.`])
  })
}

test('through the deck: a repository whose filter settings move while git reads its working tree (a definition raced in) has that run`s output dropped and runs no git again this session, saying why once; a setting that names no filter may move freely', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let reads = 0
  let isRaced = false
  const { w, runs } = repoWorld(() => {
    reads += 1
    // a branch's upstream comes and goes on every read: nothing to do with filters
    const base = listing(['local', reads % 2 === 0 ? 'branch.main.remote' : 'core.bare', 'false'])
    return { exitCode: 0, stdout: isRaced && reads % 2 === 0 ? `${base}${listing(['local', 'filter.evil.clean', 'touch /tmp/pwned'])}` : base }
  })
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('changes'))
  await clock.advance(1000)
  const ui = await $.ui.mount(pane('terminal'))
  expect(JSON.stringify(await ui.drawn())).toContain('app.ts')
  await ui.unmount()
  expect(w.toasts.filter(text => text.includes('changed while'))).toEqual([])
  isRaced = true
  await clock.advance(7000)
  expect(w.toasts.filter(text => text.includes('changed while'))).toEqual([`work: ${G.SETTINGS_MOVED}`])
  const ran = runs.length
  await clock.advance(7000)
  await clock.advance(7000)
  // refused from then on: not even a read of its settings
  expect(runs.length).toBe(ran)
  expect(w.toasts.filter(text => text.includes('changed while')).length).toBe(1)
})

test('through the deck: an untracked symbolic link is never read through (its diff is the target`s path, as git shows a link, never the target`s content), an untracked file whose real place is outside the repository is left out, not read, and a plain one is read through web/files.js alone, never `fs.read`', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const norm = (p: string) => p.replace(/\\/g, '/')
  // three untracked files: a link to a secret outside the repository, a plain file inside it, and one whose real place is outside (reached through a parent alias)
  const w = newWorld({
    gitConfig: () => ({ exitCode: 0, stdout: '' }),
    git: (argv, cwd = '') => {
      const line = argv.join(' ')
      if (norm(cwd) !== '/work') return { exitCode: 128, stdout: '' }
      if (line.includes('rev-parse --show-toplevel')) return { exitCode: 0, stdout: '/work\n' }
      if (line.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: 'main\n' }
      if (line.includes('rev-parse --verify')) return { exitCode: 0, stdout: `${'a'.repeat(40)}\n` }
      if (line.includes('status --porcelain')) return { exitCode: 0, stdout: '?? id_rsa\0?? inside.txt\0?? escape\0' }
      if (line.includes('--numstat')) return { exitCode: 0, stdout: '' }
      return { exitCode: 1, stdout: '' }
    },
    stat: path => {
      const p = norm(path)
      if (p === '/work') return { size: 0, mtimeMs: NOW, kind: 'dir', realPath: '/work' }
      if (p === '/work/id_rsa') return { size: 20, mtimeMs: NOW, kind: 'file', isLink: true, realPath: '/secrets/id_rsa' }
      if (p === '/work/inside.txt') return { size: 12, mtimeMs: NOW, kind: 'file', realPath: '/work/inside.txt' }
      if (p === '/work/escape') return { size: 14, mtimeMs: NOW, kind: 'file', realPath: '/elsewhere/escape' }
      return null
    },
  })
  // what each path holds, for web/files.js (its safe reads) and for `fs.read` alike; a read of the link or of anything outside the repository would be a leak
  const files: Record<string, string> = { '/work/inside.txt': 'hello\nworld\n', '/work/id_rsa': 'TOP-SECRET-KEY', '/secrets/id_rsa': 'TOP-SECRET-KEY', '/work/escape': 'ESCAPED-SECRET', '/elsewhere/escape': 'ESCAPED-SECRET' }
  w.onDisk = files
  world(on, w)
  const reads: string[] = []
  on('fs.read', ($, e) => {
    const p = norm(e.path)
    reads.push(p)
    return files[p] !== undefined ? { value: files[p] } : { deny: 'no such file' }
  })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('changes'))
  await clock.advance(1000)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: W.fileKeyOf('id_rsa') })
  await clock.advance(1000)
  await ui.redraw()
  let drawn = JSON.stringify(await ui.drawn())
  // the link's diff is its target's path, never its content
  expect(drawn).toContain('/secrets/id_rsa')
  expect(drawn).not.toContain('TOP-SECRET-KEY')
  await ui.press({ key: W.fileKeyOf('id_rsa') })
  await ui.redraw()
  await ui.press({ key: W.fileKeyOf('escape') })
  await clock.advance(1000)
  await ui.redraw()
  drawn = JSON.stringify(await ui.drawn())
  // a file whose real place is outside the repository is left out, its content never shown
  expect(drawn).toContain('outside the repository')
  expect(drawn).not.toContain('ESCAPED-SECRET')
  await ui.unmount()
  // the deck read the plain file inside the repository through web/files.js, and never the link or anything outside; `fs.read` read no untracked file at all
  expect(w.fileReads).toContain('/work/inside.txt')
  expect(w.fileReads.some(p => p !== '/work/inside.txt')).toBe(false)
  expect(reads.some(p => Object.hasOwn(files, p))).toBe(false)
})

test('through the deck: an untracked file swapped for a link after the deck`s look is refused by web/files.js and shows nothing of the link`s target; a file that did not move is read once, kept, and read again once its size or time moves', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let mtime = NOW
  const w = newWorld({
    gitConfig: () => ({ exitCode: 0, stdout: '' }),
    git: argv => {
      const line = argv.join(' ')
      if (line.includes('rev-parse --show-toplevel')) return { exitCode: 0, stdout: '/work\n' }
      if (line.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: 'main\n' }
      if (line.includes('rev-parse --verify')) return { exitCode: 0, stdout: `${'a'.repeat(40)}\n` }
      if (line.includes('status --porcelain')) return { exitCode: 0, stdout: '?? notes.txt\0?? swapped.txt\0' }
      return { exitCode: 0, stdout: '' }
    },
    // both look like plain files inside the repository to `fs.stat`
    stat: path => (path.replace(/\\/g, '/') === '/work' ? { size: 0, mtimeMs: NOW, kind: 'dir', realPath: '/work' } : { size: 12, mtimeMs: mtime }),
  })
  // on the disk, as web/files.js finds them: swapped.txt became a link to a secret between the deck's look and the open, which refuses it (O_NOFOLLOW_ANY: ELOOP)
  w.onDisk = { '/work/notes.txt': 'hello\nworld\n', '/work/swapped.txt': 'TOP-SECRET-KEY' }
  w.safeRead = abs => (abs === '/work/swapped.txt' ? { kind: 'refused', why: 'a link on the way' } : undefined)
  w.files = { '/work/swapped.txt': 'TOP-SECRET-KEY', '/work/notes.txt': 'TOP-SECRET-KEY' }
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('changes'))
  await clock.advance(1000)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: W.fileKeyOf('swapped.txt') })
  await clock.advance(1000)
  await ui.redraw()
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Could not read this new file.')
  expect(drawn).not.toContain('TOP-SECRET-KEY')
  // the row counts the plain one's lines, and none for the refused one
  expect(drawn).toContain('+2')
  // read once; a refresh where nothing moved runs no node for it (the refused one is asked again)
  const asked = () => w.fileReads.filter(place => place === '/work/notes.txt').length
  expect(asked()).toBe(1)
  await clock.advance(7000)
  await ui.redraw()
  expect(asked()).toBe(1)
  expect(w.fileReads.filter(place => place === '/work/swapped.txt').length).toBeGreaterThan(1)
  // its time moved: read again
  mtime = NOW + 5000
  await clock.advance(7000)
  await ui.redraw()
  expect(asked()).toBe(2)
  await ui.unmount()
})

test('through the deck: a file a repository named with control characters or a bidirectional override still draws, on the terminal and the desktop, each shown as U+FFFD', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { w } = repoWorld(() => ({ exitCode: 0, stdout: '' }), ' M app.ts\0?? evil\u001b[2J\u009b31m.ts\0?? invoice‮fdp.exe\0')
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('changes'))
  await clock.advance(1000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface))
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('evil�[2J�31m.ts')
    expect(drawn).toContain('invoice�fdp.exe')
    expect(drawn).not.toMatch(/[\u001b\u009b‮]/)
    await ui.unmount()
  }
})
