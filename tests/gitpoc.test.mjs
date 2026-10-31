/**
 * Git with a hostile repository, for real: `node --test tests/gitpoc.test.mjs`
 * (POSIX; Claude Code's own `plugin test` leaves `.mjs` files alone).
 *
 * The deck runs git every few seconds in any repository an agent edits in,
 * which may be anywhere on the disk. Each repository built here asks git, in
 * its own `.git/config` (or a file it includes, its worktree config, its
 * attributes, a submodule's config), to run a program that leaves a marker
 * file. Every command the deck runs (`G.argv`) runs in each, exactly as the
 * deck's `runGit` runs it (the repository's settings read first,
 * `G.repoConfigOf`, then `G.argvIn`), twice: as Claude Code's
 * `$.process.run` starts git (its own `-c` guards in `GIT_CONFIG_*`), and
 * bare, without them, so the deck's own options hold on their own. No
 * marker may appear. A filter driver the person's own global config defines
 * keeps running.
 *
 * `GITPOC_MODULE=<path to an older hooks/git.ts>` runs the same against that
 * module, as the deck ran it then (git started in the repository): it fails.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const G = await import(process.env.GITPOC_MODULE ? pathToFileURL(path.resolve(process.env.GITPOC_MODULE)).href : new URL('../hooks/git.ts', import.meta.url).href)
const isOld = typeof G.repoConfigOf !== 'function'

/** What Claude Code 2.1.309's `$.process.run` adds when it starts git (read off a real session): its own guards, as `-c` settings in the environment. */
const ENGINE_GUARDS = [
  ['core.fsmonitor', ''],
  ['core.hooksPath', '/dev/null'],
  ['core.askPass', ''],
  ['protocol.ext.allow', 'never'],
  ['submodule.recurse', 'false'],
  ['log.showSignature', 'false'],
  ['format.pretty', 'medium'],
  ['gc.auto', '0'],
  ['maintenance.auto', 'false'],
  ...['applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'pre-receive', 'update', 'proc-receive', 'post-receive', 'post-update', 'reference-transaction', 'push-to-checkout', 'pre-auto-gc', 'post-rewrite', 'sendemail-validate', 'fsmonitor-watchman', 'p4-changelist', 'p4-prepare-changelist', 'p4-post-changelist', 'p4-pre-submit', 'post-index-change'].map(hook => [`hook.${hook}.enabled`, 'false']),
]
const ENGINE_ENV = {
  GIT_CONFIG_COUNT: String(ENGINE_GUARDS.length),
  ...Object.fromEntries(ENGINE_GUARDS.flatMap(([key, value], i) => [[`GIT_CONFIG_KEY_${i}`, key], [`GIT_CONFIG_VALUE_${i}`, value]])),
  GIT_LFS_SKIP_SMUDGE: '1',
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_PROXY_COMMAND: '',
  NoDefaultCurrentDirectoryInExePath: '1',
}

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apiarius-gitpoc-')))
const MARKS = path.join(TMP, 'marks')
const BIN = path.join(TMP, 'bin')
/** Where git starts, as the session's own folder: nothing there. */
const SESSION = path.join(TMP, 'session')
/** The person's own global config: one filter driver of theirs (`lfs`), trusted. */
const HOME = path.join(TMP, 'home')
fs.mkdirSync(MARKS)
fs.mkdirSync(BIN)
fs.mkdirSync(SESSION)
fs.mkdirSync(HOME)
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }))

const BASE_ENV = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME,
  GIT_CONFIG_GLOBAL: path.join(HOME, '.gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Poc',
  GIT_AUTHOR_EMAIL: 'poc@example.com',
  GIT_COMMITTER_NAME: 'Poc',
  GIT_COMMITTER_EMAIL: 'poc@example.com',
  ...G.GIT_ENV,
}

/** A program that leaves the marker `name` and passes what it reads through (a filter, a text conversion). */
function marker(name) {
  const file = path.join(BIN, name)
  fs.writeFileSync(file, `#!/bin/sh\n: > '${path.join(MARKS, name)}'\nif [ -f "$1" ]; then cat "$1"; else cat; fi\n`)
  fs.chmodSync(file, 0o755)
  return file
}

function marks() {
  return fs.readdirSync(MARKS).sort()
}

function clearMarks() {
  for (const name of fs.readdirSync(MARKS)) fs.rmSync(path.join(MARKS, name))
}

/** git, to build the repositories (none of the deck's). */
function sh(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: { ...BASE_ENV, GIT_NO_LAZY_FETCH: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** A repository with two commits, a modified file and one touched but the same, so status and diff read the working tree. */
function repo(name, attributes = '') {
  const dir = path.join(TMP, 'repos', name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  sh(dir, 'init', '-q', '-b', 'main')
  if (attributes) fs.writeFileSync(path.join(dir, '.gitattributes'), attributes)
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  fs.writeFileSync(path.join(dir, 'b.txt'), 'same\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-qm', 'first')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n')
  sh(dir, 'commit', '-qam', 'second')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\nthree\n')
  fs.writeFileSync(path.join(dir, 'b.txt'), 'SAME\n')
  return dir
}

/** Sets `key` in a repository's own `.git/config` (or `--worktree`). */
function set(dir, key, value, where = '--local') {
  sh(dir, 'config', where, key, value)
}

/** A commit whose header carries a signature, for git to verify where its settings say so. */
function signedCommit(dir, header) {
  const tree = sh(dir, 'rev-parse', 'HEAD^{tree}').trim()
  const parent = sh(dir, 'rev-parse', 'HEAD').trim()
  const body = `tree ${tree}\nparent ${parent}\nauthor Poc <poc@example.com> 1700000000 +0000\ncommitter Poc <poc@example.com> 1700000000 +0000\ngpgsig ${header}\n \n -----END-----\n\nsigned\n`
  const hash = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: dir, env: BASE_ENV, input: body, encoding: 'utf8' }).trim()
  sh(dir, 'update-ref', 'HEAD', hash)
}

fs.writeFileSync(path.join(HOME, '.gitconfig'), `[filter "lfs"]\n\tclean = '${marker('trusted-lfs')}'\n\tsmudge = cat\n\trequired = true\n`)

/** Each hostile repository: what it tries, and the repository (its folder). */
const HOSTILE = {
  'core.fsmonitor': () => {
    const dir = repo('fsmonitor')
    set(dir, 'core.fsmonitor', marker('fsmonitor'))
    return dir
  },
  'core.fsmonitor in the worktree config': () => {
    const dir = repo('fsmonitor-worktree')
    set(dir, 'extensions.worktreeConfig', 'true')
    set(dir, 'core.fsmonitor', marker('fsmonitor-worktree'), '--worktree')
    return dir
  },
  'filter clean': () => {
    const dir = repo('filter-clean', '* filter=evil\n')
    set(dir, 'filter.evil.clean', marker('filter-clean'))
    return dir
  },
  'filter process': () => {
    const dir = repo('filter-process', '* filter=evil\n')
    set(dir, 'filter.evil.process', marker('filter-process'))
    return dir
  },
  'filter smudge, required': () => {
    const dir = repo('filter-required', '* filter=evil\n')
    set(dir, 'filter.evil.clean', marker('filter-required'))
    set(dir, 'filter.evil.smudge', marker('filter-required-smudge'))
    set(dir, 'filter.evil.required', 'true')
    return dir
  },
  'filter in an included file': () => {
    const dir = repo('filter-include', '* filter=inc.dotted\n')
    fs.writeFileSync(path.join(dir, 'evil.cfg'), `[filter "inc.dotted"]\n\tclean = '${marker('filter-include')}'\n`)
    set(dir, 'include.path', '../evil.cfg')
    return dir
  },
  'filter in an includeIf file': () => {
    const dir = repo('filter-includeif', '* filter=cond\n')
    fs.writeFileSync(path.join(dir, 'cond.cfg'), `[filter "cond"]\n\tclean = '${marker('filter-includeif')}'\n`)
    fs.appendFileSync(path.join(dir, '.git', 'config'), '[includeIf "gitdir:**"]\n\tpath = ../cond.cfg\n')
    return dir
  },
  'filter in the worktree config': () => {
    const dir = repo('filter-worktree', '* filter=wt\n')
    set(dir, 'extensions.worktreeConfig', 'true')
    set(dir, 'filter.wt.clean', marker('filter-worktree'), '--worktree')
    return dir
  },
  'filter named in .git/info/attributes': () => {
    const dir = repo('filter-info')
    fs.mkdirSync(path.join(dir, '.git', 'info'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.git', 'info', 'attributes'), '* filter=info\n')
    set(dir, 'filter.info.clean', marker('filter-info'))
    return dir
  },
  'filter named in core.attributesFile': () => {
    const dir = repo('filter-attrfile')
    fs.writeFileSync(path.join(dir, 'attrs'), '* filter=attrfile\n')
    set(dir, 'core.attributesFile', path.join(dir, 'attrs'))
    set(dir, 'filter.attrfile.clean', marker('filter-attrfile'))
    return dir
  },
  'the person`s lfs filter redefined': () => {
    const dir = repo('filter-lfs-hijack', '* filter=lfs\n')
    set(dir, 'filter.lfs.clean', marker('filter-lfs-hijack'))
    set(dir, 'filter.lfs.required', 'false')
    return dir
  },
  'the person`s lfs filter given a process of its own': () => {
    const dir = repo('filter-lfs-process', '* filter=lfs\n')
    set(dir, 'filter.lfs.process', marker('filter-lfs-process'))
    return dir
  },
  'a filter whose name the command line cannot carry': () => {
    const dir = repo('filter-odd-name', '* filter=a=b\n')
    fs.appendFileSync(path.join(dir, '.git', 'config'), `[filter "a=b"]\n\tclean = '${marker('filter-odd-name')}'\n`)
    return dir
  },
  'diff textconv': () => {
    const dir = repo('textconv', '* diff=evil\n')
    set(dir, 'diff.evil.textconv', marker('textconv'))
    return dir
  },
  'diff driver command': () => {
    const dir = repo('diff-command', '* diff=evil\n')
    set(dir, 'diff.evil.command', marker('diff-command'))
    return dir
  },
  'diff.external': () => {
    const dir = repo('diff-external')
    set(dir, 'diff.external', marker('diff-external'))
    return dir
  },
  'a signature checked with gpg.program': () => {
    const dir = repo('gpg')
    signedCommit(dir, '-----BEGIN PGP SIGNATURE-----')
    set(dir, 'log.showSignature', 'true')
    set(dir, 'gpg.program', marker('gpg'))
    return dir
  },
  'a signature checked with gpg.ssh.program': () => {
    const dir = repo('gpg-ssh')
    signedCommit(dir, '-----BEGIN SSH SIGNATURE-----')
    set(dir, 'log.showSignature', 'true')
    set(dir, 'gpg.ssh.program', marker('gpg-ssh'))
    set(dir, 'gpg.ssh.allowedSignersFile', path.join(dir, 'signers'))
    return dir
  },
  'hooks, and core.hooksPath': () => {
    const dir = repo('hooks')
    const hooks = path.join(dir, 'myhooks')
    fs.mkdirSync(hooks)
    for (const hook of ['post-index-change', 'reference-transaction', 'post-checkout', 'pre-auto-gc']) {
      fs.copyFileSync(marker(`hook-${hook}`), path.join(hooks, hook))
      fs.copyFileSync(marker(`githook-${hook}`), path.join(dir, '.git', 'hooks', hook))
      fs.chmodSync(path.join(hooks, hook), 0o755)
      fs.chmodSync(path.join(dir, '.git', 'hooks', hook), 0o755)
    }
    set(dir, 'core.hooksPath', hooks)
    return dir
  },
  'pagers': () => {
    const dir = repo('pager')
    set(dir, 'core.pager', marker('pager'))
    for (const cmd of ['diff', 'log', 'show', 'status']) set(dir, `pager.${cmd}`, marker(`pager-${cmd}`))
    return dir
  },
  'a submodule`s own fsmonitor and filter': () => {
    const inner = repo('sub-inner-1', '* filter=inner\n')
    const dir = repo('submodule-status')
    sh(dir, 'submodule', 'add', '-q', inner, 'inner')
    sh(dir, 'commit', '-qm', 'submodule')
    const module = path.join(dir, '.git', 'modules', 'inner')
    sh(module, 'config', 'core.fsmonitor', marker('submodule-fsmonitor'))
    sh(module, 'config', 'filter.inner.clean', marker('submodule-filter'))
    fs.appendFileSync(path.join(dir, 'inner', 'a.txt'), 'dirty\n')
    return dir
  },
  'diff.submodule=diff into a submodule`s own text conversion': () => {
    const inner = repo('sub-inner-2', '* diff=inner\n')
    const dir = repo('submodule-diff')
    sh(dir, 'submodule', 'add', '-q', inner, 'inner')
    sh(dir, 'commit', '-qm', 'submodule')
    const module = path.join(dir, '.git', 'modules', 'inner')
    sh(module, 'config', 'diff.inner.textconv', marker('submodule-textconv'))
    fs.appendFileSync(path.join(dir, 'inner', 'a.txt'), 'moved\n')
    sh(path.join(dir, 'inner'), 'commit', '-qam', 'moved')
    set(dir, 'diff.submodule', 'diff')
    set(dir, 'status.submoduleSummary', 'true')
    return dir
  },
  'a lazy fetch of a partial clone, through its remote`s uploadpack': () => {
    const source = repo('lazy-source')
    sh(source, 'config', 'uploadpack.allowFilter', 'true')
    const dir = path.join(TMP, 'repos', 'lazy')
    fs.rmSync(dir, { recursive: true, force: true })
    sh(TMP, 'clone', '-q', '--filter=blob:none', `file://${source}`, dir)
    const pack = path.join(BIN, 'uploadpack')
    fs.writeFileSync(pack, `#!/bin/sh\n: > '${path.join(MARKS, 'lazy-fetch')}'\nexit 1\n`)
    fs.chmodSync(pack, 0o755)
    set(dir, 'remote.origin.uploadpack', pack)
    set(dir, 'protocol.file.allow', 'always')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n')
    return dir
  },
  'an upstream with core.sshCommand': () => {
    const dir = repo('upstream')
    set(dir, 'remote.origin.url', 'ssh://example.invalid/x.git')
    set(dir, 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*')
    set(dir, 'branch.main.remote', 'origin')
    set(dir, 'branch.main.merge', 'refs/heads/main')
    sh(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD~1')
    set(dir, 'core.sshCommand', marker('ssh'))
    set(dir, 'credential.helper', `!${marker('credential')}`)
    return dir
  },
}

/** Every command the deck runs, as it runs them in a repository at `head`. */
function commandsOf(head) {
  const a = G.argv
  return {
    toplevel: a.toplevel,
    branch: a.branch,
    head: a.head,
    upstream: a.upstream,
    aheadBehind: a.aheadBehind,
    status: a.status,
    numstat: a.numstat('HEAD'),
    'numstat (no commit yet)': a.numstat(G.EMPTY_TREE),
    'fileDiff (all)': a.fileDiff('HEAD', []),
    'fileDiff (a file)': a.fileDiff('HEAD', ['a.txt', 'inner']),
    log: a.log(30),
    countSince: a.countSince('midnight'),
    statSince: a.statSince('1970-01-01 00:00:00 +0000'),
    showMeta: a.showMeta(head),
    showNumstat: a.showNumstat(head),
    showPatch: a.showPatch(head),
    newSince: a.newSince(`${head}~1`),
    recentHashes: a.recentHashes,
  }
}

function git(argv, env, cwd) {
  const ran = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: 'utf8', timeout: 20_000 })
  return { ok: ran.status === 0, out: ran.stdout ?? '', err: ran.stderr ?? '' }
}

/** The filter driver names a repository's attribute files name, as the deck reads them beside the config (its top-level `.gitattributes`, its `.git/info/attributes`, and the `core.attributesFile` its own config names). */
function attrNamesOf(dir, listing) {
  const texts = []
  for (const p of [path.join(dir, '.gitattributes'), path.join(dir, '.git', 'info', 'attributes')]) {
    try { texts.push(fs.readFileSync(p, 'utf8')) } catch {}
  }
  const named = G.localAttributesFileOf(listing).trim()
  if (named) { try { texts.push(fs.readFileSync(named, 'utf8')) } catch {} }
  return G.attrFilterNamesOf(texts)
}

/** One command run in `dir` as the deck's `runGit` runs it (the old module's way: git started in the repository); what it printed, or why it ran nothing. */
function runAsDeck(args, dir, env) {
  if (isOld) return git(args, env, dir)
  const listed = git(G.argvIn(G.argv.config, dir), env, SESSION)
  if (!listed.ok) return { ok: false, out: '', err: G.configRefusalOf(listed.err), isRefused: true }
  const plan = G.repoConfigOf(listed.out, attrNamesOf(dir, listed.out))
  if ('refusal' in plan) return { ok: false, out: '', err: plan.refusal, isRefused: true }
  return git(G.argvIn(args, dir, plan.overrides), env, SESSION)
}

const MODES = { 'as Claude Code starts git': { ...BASE_ENV, ...ENGINE_ENV }, 'bare git, no guards of Claude Code`s': BASE_ENV }

for (const [what, build] of Object.entries(HOSTILE)) {
  test(`a repository whose own settings try ${what}: no command the deck runs runs it`, () => {
    const dir = build()
    const head = sh(dir, 'rev-parse', 'HEAD').trim()
    const ran = []
    for (const [mode, env] of Object.entries(MODES)) {
      for (const [name, args] of Object.entries(commandsOf(head))) {
        clearMarks()
        const out = runAsDeck(args, dir, env)
        const left = marks().filter(mark => mark !== 'trusted-lfs')
        if (left.length > 0) ran.push(`${mode}: ${name} ran ${left.join(', ')}`)
        if (name === 'status' && !out.isRefused) assert.ok(out.ok, `${mode}: status failed: ${out.err}`)
      }
    }
    assert.deepEqual(ran, [])
  })
}

test('the person`s own global filter driver (git-lfs) keeps running in a repository that names it, and the deck says nothing of it', { skip: isOld }, () => {
  const dir = repo('lfs-global', '* filter=lfs\n')
  clearMarks()
  const listed = git(G.argvIn(G.argv.config, dir), BASE_ENV, SESSION)
  const plan = G.repoConfigOf(listed.out)
  assert.deepEqual(plan, { overrides: [], drivers: [] })
  const out = runAsDeck(G.argv.numstat('HEAD'), dir, { ...BASE_ENV, ...ENGINE_ENV })
  assert.ok(out.ok, out.err)
  assert.deepEqual(marks(), ['trusted-lfs'])
})

test('a repository that redefines the person`s lfs filter runs the person`s, not its own; one that gives it a process (which git runs first, and which the command line can blank but not unset), or a driver of its own, has it switched off and named', { skip: isOld }, () => {
  const planOf = name => G.repoConfigOf(git(G.argvIn(G.argv.config, path.join(TMP, 'repos', name)), BASE_ENV, SESSION).out)
  HOSTILE['the person`s lfs filter redefined']()
  const plan = planOf('filter-lfs-hijack')
  assert.deepEqual(plan, { overrides: ['-c', `filter.lfs.clean='${path.join(BIN, 'trusted-lfs')}'`, '-c', 'filter.lfs.smudge=cat', '-c', 'filter.lfs.required=true'], drivers: [] })
  clearMarks()
  assert.ok(runAsDeck(G.argv.numstat('HEAD'), path.join(TMP, 'repos', 'filter-lfs-hijack'), BASE_ENV).ok)
  assert.deepEqual(marks(), ['trusted-lfs'])
  HOSTILE['the person`s lfs filter given a process of its own']()
  assert.deepEqual(planOf('filter-lfs-process'), { overrides: ['-c', `filter.lfs.clean='${path.join(BIN, 'trusted-lfs')}'`, '-c', 'filter.lfs.smudge=cat', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false'], drivers: ['lfs'] })
  HOSTILE['filter clean']()
  assert.deepEqual(planOf('filter-clean'), { overrides: ['-c', 'filter.evil.clean=', '-c', 'filter.evil.required=false'], drivers: ['evil'] })
})

test('a filter the repository defines in its config AFTER the deck read its config, but names in its attributes before, does not run: the deck blanks every filter its attributes name, so a late definition has nothing to attach to (the config-read race)', { skip: isOld }, () => {
  // the attribute names the filter up front; no filter.evil in the config when the deck reads it
  const dir = repo('toctou', '* filter=evil\n')
  const env = { ...BASE_ENV, ...ENGINE_ENV }
  const listed = git(G.argvIn(G.argv.config, dir), env, SESSION)
  // without the attribute-aware blanking, a filter written after the read runs (the race the config read alone misses)
  fs.appendFileSync(path.join(dir, '.git', 'config'), `[filter "evil"]\n\tclean = '${marker('toctou')}'\n`)
  clearMarks()
  const racey = G.repoConfigOf(listed.out) // overrides: [] (the config read saw no filter.evil)
  git(G.argvIn(G.argv.status, dir, racey.overrides), env, SESSION)
  git(G.argvIn(G.argv.fileDiff('HEAD', []), dir, racey.overrides), env, SESSION)
  assert.ok(marks().includes('toctou'), 'without the fix, the late filter runs')
  // with it: every filter the attributes name is blanked on the command line, so the late definition cannot attach
  const safe = G.repoConfigOf(listed.out, attrNamesOf(dir, listed.out))
  clearMarks()
  const out = git(G.argvIn(G.argv.status, dir, safe.overrides), env, SESSION)
  assert.ok(out.ok, out.err)
  git(G.argvIn(G.argv.fileDiff('HEAD', []), dir, safe.overrides), env, SESSION)
  assert.deepEqual(marks().filter(mark => mark !== 'trusted-lfs'), [])
})

test('git starts in the session`s own folder and changes to the repository itself, so no program the repository holds is the one found by name', () => {
  if (!isOld) assert.deepEqual(G.argvIn(G.argv.status, '/r').slice(0, 3), ['git', '-C', '/r'])
  const dir = repo('planted-git')
  fs.copyFileSync(marker('planted-git'), path.join(dir, 'git'))
  fs.chmodSync(path.join(dir, 'git'), 0o755)
  clearMarks()
  // a search path that starts with the working folder, as a careless one may
  const env = { ...BASE_ENV, PATH: `.:${BASE_ENV.PATH}` }
  const out = runAsDeck(G.argv.status, dir, env)
  assert.ok(out.ok, out.err)
  assert.deepEqual(marks(), [])
})
