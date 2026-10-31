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

import * as G from '../hooks/git'
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
