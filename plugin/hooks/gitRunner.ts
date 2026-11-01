/**
 * Git, run for the deck: every command ./git builds, run with its guards
 * (`runGit`: where git's settings come from read first, the repository's own
 * filters off, and its output dropped if they moved while it ran), the
 * repositories agents work in found and followed (./repos), and what
 * Changes reads: the branch and the uncommitted files (`refreshGit`), git's
 * own diff of each while the web deck is on (`readGitDiffs`), a file's diff
 * (`loadFileDiff`) and a commit (`loadCommit`). Untracked and attribute files
 * are read through web/files.js (`readSafely`), never following a link.
 *
 * Its state is its own (`git`, the file and the commit open, git's diffs),
 * read by the hooks module (register.tsx) and the web deck through the
 * accessors below; what it reads of the hooks module's (the session's data,
 * view and folder) and asks of it (a redraw, a save) it imports from there.
 */
import type { EngineInterface, Timer } from 'claude-code'

import { addedFileHunks, filePatchesOf, hunksOf, type Hunk } from './diff'
import * as FB from './files'
import * as F from './format'
import * as G from './git'
import * as M from './model'
import { currentCwd, currentData, currentView, redraw, redrawIfChanged, save } from './register'
import * as R from './repos'
import * as W from './web'
import { isSharing, nodeCwd } from './webServer'

let git: G.GitState = G.emptyGit()
let fileDiff: G.FileDiff | null = null
let commit: G.CommitDetail | null = null
let isGitBusy = false
let isGitQueued = false
let isHeavyQueued = false
let lastGitAt = 0
let lastHeavyAt = 0
/** Git's timer: its next read of the repository (`scheduleGit`). */
const timers: { git?: Timer } = {}

/**
 * Git's own diff of each uncommitted file, by path, as the web deck serves
 * it (gitdiffs/<id>.diff, `W.GitDiffs`): read after each read of git while
 * the web deck is on (`readGitDiffs`), and replaced whole when one changes.
 */
let gitDiffs: W.GitDiffs = new Map()

/** Git's state as the deck last read it (`refreshGit`). */
export function currentGit(): G.GitState {
  return git
}

/** The file whose diff Changes has open, as read (`loadFileDiff`); null for none. */
export function currentFileDiff(): G.FileDiff | null {
  return fileDiff
}

/** The commit Changes has open, as read (`loadCommit`); null for none. */
export function currentCommit(): G.CommitDetail | null {
  return commit
}

/** Git's own diff of each uncommitted file (`gitDiffs`). */
export function currentGitDiffs(): W.GitDiffs {
  return gitDiffs
}

/** When git was read last; 0 before. */
export function lastGitRead(): number {
  return lastGitAt
}

/** Which repository each directory agents edit in belongs to (`book`): an edit notes its own there. */
export function repoBook(): R.RepoBook {
  return book
}

/** Lets the file's diff Changes had open go: the next one is read afresh. */
export function closeFileDiff(): void {
  fileDiff = null
}

/** Lets the commit Changes had open go. */
export function closeCommit(): void {
  commit = null
}

const REPO_PIN = { plugin: 'apiarius', key: 'repo' } as const

/** Which repository each directory agents edit in belongs to, and the one the deck follows. */
let book: R.RepoBook = R.emptyBook()
/** The pin as `$.state` holds it. */
let savedPin = ''
/** The root the edits' display paths are made against; null until the first look. */
let shownRoot: string | null = null

/** What the deck told the person once about a repository's own git settings (a filter switched off, a repository it runs no git in, a git too old), by what it said. */
const gitTold = new Set<string>()

/** Says `text` once a session (a toast), however often git meets it again. */
function tellGitOnce($: EngineInterface, text: string) {
  if (gitTold.has(text)) return
  gitTold.add(text)
  $.ui.toast(text)
}

/** A git run's outcome: whether it exited 0, and what it printed. */
type GitRun = { ok: boolean; out: string; err: string }

/** The repositories the deck runs no git in again this session (their filter settings moved while it read them), by `R.keyOf` of where, and why. */
const gitRefused = new Map<string, string>()

/** The person's own home folder (`USERPROFILE`, else `HOME`), read once: where a repository's `~/` attribute file lies; '' when unknown. */
let userHome: string | null = null

/**
 * Reads attribute files through web/files.js (`readSafely`): `places` under
 * `root`, each a regular file there with no link anywhere on its way, at most
 * `G.MOST_ATTR_BYTES`. Their texts, the places not there, or the first one
 * that is a link, no plain file, too big or unreadable (`refused`).
 */
async function readAttrFiles($: EngineInterface, root: string, places: readonly string[]): Promise<{ texts: string[]; missing: string[] } | { refused: string }> {
  const stats = await Promise.all(
    places.map(async place => {
      try {
        return { place, stat: await $.fs.stat(joinPath(root, place)) }
      } catch {
        return { place, stat: null }
      }
    }),
  )
  const missing = stats.filter(one => one.stat === null).map(one => one.place)
  const wanted: Wanted[] = []
  for (const { place, stat } of stats) {
    if (stat === null) continue
    if (stat.isLink || stat.kind !== 'file' || stat.size > G.MOST_ATTR_BYTES) return { refused: place }
    wanted.push({ place, abs: joinPath(root, place), size: stat.size, mtimeMs: stat.mtimeMs })
  }
  const read = await readSafely($, root, wanted, G.MOST_ATTR_BYTES, G.MOST_ATTR_BYTES)
  const texts: string[] = []
  for (const one of wanted) {
    const got = read.get(one.place)
    if (got?.kind === 'none') missing.push(one.place)
    else if (got?.kind === 'file' && got.text !== undefined) texts.push(got.text)
    else if (got === undefined && isNodeMissing) {
      // no node to read it safely: the engine's read, after the look above. Only the filter names in it are taken, never shown, so a link swapped in here hands over no text
      try {
        texts.push(await $.fs.read(one.abs))
      } catch {
        return { refused: one.place }
      }
    } else return { refused: one.place }
  }
  return { texts, missing }
}

/** Splits an absolute path into its folder and its name, for `readAttrFiles` (a drive's or the disk's root stays a root). */
function folderAndName(path: string): [string, string] {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const folder = cut <= 0 ? '/' : path.slice(0, cut)
  return [/^[A-Za-z]:$/.test(folder) ? `${folder}/` : folder, path.slice(cut + 1)]
}

/**
 * The filter driver names a repository's attribute files name (`filter=NAME`,
 * a macro's own line included), read there and then beside its config, so
 * each can be switched off even if the repository defines it in its config
 * after the deck read that (`G.attrFilterNamesOf`): every `.gitattributes`
 * git lists in it (tracked, untracked or ignored, nested ones too:
 * `G.argv.attrFiles`, `G.argv.ignoredAttrFiles`; a tracked one gone from the
 * working tree as the index holds it, which git reads then), its
 * `info/attributes` where git keeps it, and the `core.attributesFile` its own
 * config names (`G.attributesFileOf`, placed as git places it). Each is read
 * through web/files.js; one that is a link, no plain file, too big or
 * unreadable is a refusal, as is a list git could not give. None of their
 * text is ever shown.
 */
async function attrNamesIn($: EngineInterface, where: string, listing: string, lists: { attrs: GitRun; ignored: GitRun; info: GitRun }, run: (argv: readonly string[], ms: number) => Promise<GitRun>): Promise<string[] | { refusal: string }> {
  const { attrs, ignored, info } = lists
  if (!attrs.ok || !ignored.ok || !info.ok) return { refusal: 'git could not list its attribute files' }
  const places = G.attrPlacesOf(attrs.out, ignored.out)
  if (places.length > G.MOST_ATTR_FILES) return { refusal: G.attrRefusalOf(`${places.length} .gitattributes files`) }
  if (userHome === null) userHome = ((await $.env.get('USERPROFILE').catch(() => undefined)) ?? (await $.env.get('HOME').catch(() => undefined)) ?? '').trim()
  const named = G.attributesFileOf(listing, where, userHome)
  if (typeof named !== 'string') return named
  const infoPath = info.out.replace(/\r?\n$/, '')
  const outside = [infoPath === '' ? '' : /^(?:[\\/]|[A-Za-z]:[\\/])/.test(infoPath) ? infoPath : joinPath(where, infoPath), named].filter(one => one !== '')
  const texts: string[] = []
  const inTree = await readAttrFiles($, where, places)
  if ('refused' in inTree) return { refusal: G.attrRefusalOf(inTree.refused) }
  texts.push(...inTree.texts)
  for (const path of outside) {
    const [folder, name] = folderAndName(path)
    const one = await readAttrFiles($, folder, [name])
    if ('refused' in one) return { refusal: G.attrRefusalOf(path) }
    texts.push(...one.texts)
  }
  // a tracked one gone from the working tree: git reads the index's
  for (const place of inTree.missing.slice(0, 16)) {
    const blob = await run(G.argvIn(G.argv.indexBlob(place), where), 5_000)
    if (!blob.ok) continue
    if (blob.out.length > G.MOST_ATTR_BYTES) return { refusal: G.attrRefusalOf(place) }
    texts.push(blob.out)
  }
  if (inTree.missing.length > 16) return { refusal: G.attrRefusalOf(inTree.missing[16] ?? '') }
  return G.attrFilterNamesOf(texts)
}

/**
 * Runs git in `where`, the repository shown unless told otherwise; with
 * none, runs nothing. Each run first reads where git's settings there come
 * from (`G.argv.config`), there and then, so nothing the repository's own
 * config defines runs (`G.repoConfigOf`: its filter drivers off, the rest
 * held off by every command's own options); where git cannot say, nothing
 * runs. A command that reads the working tree (`G.readsWorktree`, the only
 * kind a filter runs in) has every filter the repository's attribute files
 * name blanked too (`attrNamesIn`), so one its config defines only after
 * that read has nothing to attach to; and once it ran, the filter settings
 * are read again: moved (`G.filterSettingsOf`), its output is dropped and
 * the repository refused for the session (`gitRefused`), with a notice.
 * Git starts in the session's own folder and changes to `where` itself
 * (`G.argvIn`).
 */
export async function runGit($: EngineInterface, args: readonly string[], timeoutMs = 15_000, where = git.root): Promise<GitRun> {
  if (!where) return { ok: false, out: '', err: 'not in a git repository' }
  const refused = gitRefused.get(R.keyOf(where))
  if (refused !== undefined) return { ok: false, out: '', err: refused }
  const run = async (argv: readonly string[], ms: number): Promise<GitRun> => {
    try {
      const ran = await $.process.run(argv, { env: G.GIT_ENV, timeoutMs: ms })
      return { ok: ran.exitCode === 0, out: ran.stdout, err: ran.stderr }
    } catch (error) {
      return { ok: false, out: '', err: error instanceof Error ? error.message : String(error) }
    }
  }
  const isTree = G.readsWorktree(args)
  const ms = Math.min(timeoutMs, 5_000)
  const none: GitRun = { ok: true, out: '', err: '' }
  const [listed, attrs, ignored, info] = await Promise.all([
    run(G.argvIn(G.argv.config, where), ms),
    isTree ? run(G.argvIn(G.argv.attrFiles, where), ms) : none,
    isTree ? run(G.argvIn(G.argv.ignoredAttrFiles, where), ms) : none,
    isTree ? run(G.argvIn(G.argv.infoAttributes, where), ms) : none,
  ])
  if (!listed.ok) {
    const why = G.configRefusalOf(listed.err)
    if (why === G.OLD_GIT) tellGitOnce($, why)
    return { ok: false, out: '', err: why }
  }
  const name = F.baseName(R.cleanPath(where))
  // the filters the repository's attribute files name, blanked too, so a definition it writes into its config after this read cannot attach to one (a race)
  const names = isTree ? await attrNamesIn($, where, listed.out, { attrs, ignored, info }, run) : []
  const plan = Array.isArray(names) ? G.repoConfigOf(listed.out, names) : names
  if ('refusal' in plan) {
    tellGitOnce($, `${name}: ${plan.refusal}`)
    return { ok: false, out: '', err: plan.refusal }
  }
  if (plan.drivers.length > 0) tellGitOnce($, `Changes reads ${name} with its own git ${plan.drivers.length === 1 ? 'filter' : 'filters'} (${plan.drivers.join(', ')}) off: files ${plan.drivers.length === 1 ? 'it handles' : 'they handle'} may show as changed.`)
  const ran = await run(G.argvIn(args, where, plan.overrides), timeoutMs)
  if (!isTree) return ran
  // a filter defined while git ran (the race): what it printed is dropped, and the repository refused from now on
  const after = await run(G.argvIn(G.argv.config, where), ms)
  if (!after.ok || G.filterSettingsOf(after.out) !== G.filterSettingsOf(listed.out)) {
    gitRefused.set(R.keyOf(where), G.SETTINGS_MOVED)
    tellGitOnce($, `${name}: ${G.SETTINGS_MOVED}`)
    return { ok: false, out: '', err: G.SETTINGS_MOVED }
  }
  return ran
}

/** The root of the repository holding `dir` as git spells it; null outside one, or where git cannot run. */
async function probeRoot($: EngineInterface, dir: string): Promise<string | null> {
  const ran = await runGit($, G.argv.toplevel, 10_000, dir || '.')
  return (ran.ok && R.rootOf(ran.out)) || null
}

/** Probes what the book has not seen yet (the session's directory, a kept pin, each new edited directory), four at a time; then looks once into a session's directory in no repository. */
async function discoverRepos($: EngineInterface): Promise<void> {
  const probes = R.probesOf(book)
  for (let i = 0; i < probes.length; i += 4) {
    await Promise.all(probes.slice(i, i + 4).map(async probe => R.settle(book, probe, await probeRoot($, probe.dir))))
  }
  if (R.needsNearby(book)) await lookNearby($)
}

/**
 * Looks once into the session's directory while it is in no repository, for
 * Changes' picks: each child directory holding a `.git` (a folder, or a
 * worktree's file), and when that last changed. No git runs: one listing and
 * a stat a child, sixteen at a time; what it found is kept for that directory.
 */
async function lookNearby($: EngineInterface): Promise<void> {
  const dir = book.cwd
  let names: string[] = []
  try {
    names = R.childDirsOf(await $.fs.list(dir))
  } catch {
    // a directory that cannot be listed offers no picks
  }
  const found: { name: string; changedAt: number }[] = []
  for (let i = 0; i < names.length; i += 16) {
    await Promise.all(
      names.slice(i, i + 16).map(async name => {
        try {
          const stat = await $.fs.stat(R.childOf(R.childOf(dir, name), '.git'))
          if (stat.kind !== 'other') found.push({ name, changedAt: stat.mtimeMs })
        } catch {
          // no .git there: not a repository's top
        }
      }),
    )
  }
  if (R.sameRoot(dir, book.cwd)) R.settleNearby(book, dir, found)
}

/** What the book tells git's state: every repository found, the pin, whether the session's directory is in one, and the picks inside it while it is not. */
function bookFields(): Pick<G.GitState, 'repos' | 'pinned' | 'isCwdRepo' | 'nearby'> {
  return { repos: R.repoList(book), pinned: book.pinned, isCwdRepo: book.cwdRoot === null ? null : book.cwdRoot !== '', nearby: R.nearbyOf(book) }
}

/** Keeps the pin in `$.state`, so a reload of the deck keeps it too. */
function savePin($: EngineInterface) {
  if (book.pinned === savedPin) return
  savedPin = book.pinned
  void $.state.set(REPO_PIN, book.pinned).catch(() => undefined)
}

/** Starts following the work: the session's repository, the ones restored edits lie in, and a pin kept from before a reload. */
export async function startRepos($: EngineInterface): Promise<void> {
  R.setCwd(book, currentCwd())
  for (const edit of currentData().edits) R.noteEdit(book, edit.abs, edit.at)
  try {
    const { value } = await $.state.get(REPO_PIN)
    if (typeof value === 'string') {
      book.pinned = value
      savedPin = value
    }
  } catch {
    // no pin kept: the deck follows the work
  }
  await refreshGit($, true)
}

/**
 * Pins the deck to the repository holding `root` (a root from `git.repos` or
 * `git.nearby`, or any directory inside a repository); '' lets it follow the
 * work again: the repository an agent edited last, else the session's own.
 * Answers why it could not ('' when it did).
 */
export async function chooseRepo($: EngineInterface, root: string): Promise<string> {
  const wanted = root.trim()
  let pin = ''
  if (wanted) {
    const known = R.lookup(book, wanted)
    pin = (known === undefined ? await probeRoot($, wanted) : known) ?? ''
    if (!pin) return `Not in a git repository: ${wanted}`
    if (known === undefined) R.settleDir(book, wanted, pin)
  }
  book.pinned = pin
  savePin($)
  git = { ...git, ...bookFields() }
  redraw($)
  await refreshGit($, true)
  return ''
}

/**
 * Moves the deck to the repository at `root` ('' for none): the file and
 * commit open in the last one close, and edits read from the new root.
 */
function switchRepo($: EngineInterface, root: string) {
  const from = shownRoot ?? R.rootOfEdits(currentData().edits)
  if (shownRoot !== null || (from !== '' && !R.sameRoot(from, root))) {
    fileDiff = null
    commit = null
    currentView().file = ''
    currentView().commit = ''
  }
  for (const edit of currentData().edits) edit.path = M.relOf(edit.abs, root || null)
  for (const file of Object.values(currentData().files)) file.path = M.relOf(file.abs, root || null)
  for (const agent of currentData().agents) agent.files = [...new Set(agent.files.map(path => R.rerootPath(path, from, root)))]
  shownRoot = root
  lastHeavyAt = 0
  git = { ...G.emptyGit(), root, ...bookFields() }
  save($)
}

function joinPath(root: string, rel: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${rel}`
}

/** The repository's own place as the file system resolves it (every link folded), for judging whether an untracked file's own place is inside it; `root` itself when it cannot be resolved. */
async function rootRealOf($: EngineInterface, root: string): Promise<string> {
  try {
    const stat = await $.fs.stat(root, { resolve: true })
    return R.cleanPath(stat.realPath ?? root)
  } catch {
    return R.cleanPath(root)
  }
}

/** Whether `real` (an absolute, resolved path) is `rootReal` or inside it. */
function isInsideRoot(real: string, rootReal: string): boolean {
  const a = R.keyOf(real)
  const b = R.keyOf(rootReal)
  return a === b || a.startsWith(`${b}/`)
}

/**
 * What an untracked path at `abs` is, as `$.fs.stat` sees it, never from
 * outside the repository (`rootReal`, resolved once): a symbolic link is
 * shown as git shows one, its target's path and never the target's content
 * (`target`, '' when it leads nowhere); a path whose real place is outside
 * the repository is left out (`outside`); a regular file inside it carries
 * its `size` and time, for the caller to read through web/files.js
 * (`readSafely`), which opens it without following a link anywhere, so a
 * file swapped for a link after this look is refused there, never read
 * through. git, asked of a path that is a link or leads outside, shows no
 * diff of its content either.
 */
type Untracked = { kind: 'link'; target: string } | { kind: 'file'; size: number; mtimeMs: number } | { kind: 'outside' } | { kind: 'gone' }
async function untrackedAt($: EngineInterface, abs: string, rootReal: string): Promise<Untracked> {
  try {
    const stat = await $.fs.stat(abs, { resolve: true })
    if (stat.isLink) return { kind: 'link', target: stat.realPath ?? '' }
    if (stat.realPath === undefined || !isInsideRoot(stat.realPath, rootReal)) return { kind: 'outside' }
    if (stat.kind !== 'file') return { kind: 'gone' }
    return { kind: 'file', size: stat.size, mtimeMs: stat.mtimeMs }
  } catch {
    return { kind: 'gone' }
  }
}

/** What web/files.js read of each file the deck reads safely (an untracked file, an attribute file), as it stood then: read again only once its size or time moves (`FB.keptOf`). */
const fileBook: FB.FileBook = new Map()

/** A file to read under a folder: its place there, its whole path, and its size and time as `$.fs.stat` saw them just before. */
type Wanted = { place: string; abs: string; size: number; mtimeMs: number }

/** web/files.js could not start at its last run (no node on PATH): a new file then shows no text, and says why. */
let isNodeMissing = false

/**
 * Reads `wanted` under `root` through web/files.js (node, no shell), never
 * with `$.fs.read`: each file is opened without following a link anywhere on
 * its path, and read only if it is a regular file. A file `fileBook` holds
 * with the same size and time is answered from there; the rest are read in
 * runs of at most 64, so a refresh where nothing changed starts no node. A
 * file the helper could not answer for is left out.
 */
async function readSafely($: EngineInterface, root: string, wanted: readonly Wanted[], most: number, textMost: number): Promise<Map<string, FB.FileRead>> {
  const out = new Map<string, FB.FileRead>()
  const fresh: Wanted[] = []
  for (const one of wanted) {
    const kept = FB.keptOf(fileBook, one.abs, one.size, one.mtimeMs, textMost)
    if (kept) out.set(one.place, kept)
    else fresh.push(one)
  }
  const script = `${$.plugin.root.replace(/[\\/]+$/, '')}/web/files.js`
  for (let i = 0; i < fresh.length; i += FB.MOST_PATHS) {
    const batch = fresh.slice(i, i + FB.MOST_PATHS)
    const paths = batch.map(one => one.place)
    let answer: Map<string, FB.FileRead> | null = null
    try {
      const ran = await $.process.run(FB.filesArgvOf(script), { stdin: FB.requestTextOf({ root, paths, most, textMost }), timeoutMs: 15_000, ...(nodeCwd() ? { cwd: nodeCwd() } : {}) })
      answer = ran.exitCode === 0 ? FB.answerOf(ran.stdout, paths) : null
      isNodeMissing = false
    } catch (error) {
      isNodeMissing = /ENOENT|not found|failed to start/i.test(error instanceof Error ? error.message : String(error))
      answer = null
    }
    if (!answer) continue
    for (const one of batch) {
      const read = answer.get(one.place)
      if (!read) continue
      FB.keep(fileBook, one.abs, one.size, one.mtimeMs, read)
      out.set(one.place, read)
    }
  }
  return out
}

/** An untracked file as the deck shows it: a link, one outside the repository, one gone, or what web/files.js read of it. */
type UntrackedRead = Exclude<Untracked, { kind: 'file' }> | FB.FileRead

/**
 * The untracked files at `places` under `root`, as the deck shows them: a
 * link as its target's path, one outside the repository or gone as such, one
 * past `most` bytes as `big`, and each plain file read safely (`readSafely`),
 * with its text when it is at most `textMost`.
 */
async function untrackedOf($: EngineInterface, root: string, places: readonly string[], most: number, textMost: number): Promise<Map<string, UntrackedRead>> {
  const rootReal = await rootRealOf($, root)
  const found = await Promise.all(places.map(async place => [place, await untrackedAt($, joinPath(root, place), rootReal)] as const))
  const out = new Map<string, UntrackedRead>()
  const wanted: Wanted[] = []
  for (const [place, one] of found) {
    if (one.kind !== 'file') out.set(place, one)
    else if (one.size > most) out.set(place, { kind: 'big', size: one.size })
    else wanted.push({ place, abs: joinPath(root, place), size: one.size, mtimeMs: one.mtimeMs })
  }
  const read = await readSafely($, root, wanted, most, textMost)
  for (const one of wanted) out.set(one.place, read.get(one.place) ?? { kind: 'gone' })
  return out
}

/** The diff a link shows: one added line, its target's path, as git shows a symbolic link (never the target's content). */
function linkHunks(target: string): Hunk[] {
  return addedFileHunks(`${target}\n`)
}

/** An untracked file's line count for its row: a link counts as its one line of target text; a file outside the repository, too big (past 1 MB), binary or unreadable is left uncounted. */
function lineCountOf(read: UntrackedRead): number | null {
  if (read.kind === 'link') return read.target === '' ? 0 : 1
  return read.kind === 'file' ? read.lines : null
}

export function scheduleGit($: EngineInterface, ms: number, isHeavy = false) {
  isHeavyQueued ||= isHeavy
  timers.git?.cancel()
  timers.git = $.clock.after(ms, () => {
    timers.git = undefined
    const heavy = isHeavyQueued
    isHeavyQueued = false
    void refreshGit($, heavy)
  })
}

/**
 * Reads the repository the deck follows (after probing any directory agents
 * newly edited in): branch, uncommitted files with counts, and (when HEAD
 * moved) the log and day totals.
 */
export async function refreshGit($: EngineInterface, isHeavy = false): Promise<void> {
  if (isGitBusy) {
    isGitQueued = true
    isHeavyQueued ||= isHeavy
    return
  }
  isGitBusy = true

  try {
    await discoverRepos($)
    const now = await $.clock.now()
    const root = R.activeRoot(book)
    if (shownRoot === null || !R.sameRoot(root, shownRoot)) switchRepo($, root)

    if (!root) {
      git = { ...G.emptyGit(), isRepo: false, checkedAt: now, ...bookFields() }
      return
    }

    const run = (args: readonly string[]) => runGit($, args, 15_000, root)
    const [branch, head, status] = await Promise.all([run(G.argv.branch), run(G.argv.head), run(G.argv.status)])

    if (!status.ok) {
      if (!R.sameRoot((await probeRoot($, root)) ?? '', root)) {
        // gone: follow the work to another repository, if any
        R.dropRepo(book, root)
        isGitQueued = true
      }
      git = { ...G.emptyGit(), root, isRepo: false, checkedAt: now, error: F.trunc(status.err.trim(), 200), ...bookFields() }
      return
    }

    const headHash = head.ok ? head.out.trim() : ''
    const numstat = await run(G.argv.numstat(headHash ? 'HEAD' : G.EMPTY_TREE))
    const rows = G.parseStatus(status.out)
    const untracked = new Map<string, number>()
    // read once for both: the line counts, and while the web deck is on the text its diffs show (`readGitDiffs` then finds it kept)
    const reads = await untrackedOf(
      $,
      root,
      rows.filter(row => row.x === '?').slice(0, 30).map(row => row.path),
      1_000_000,
      isSharing() ? W.GIT_DIFF_MOST : 0,
    )
    for (const [place, read] of reads) {
      const lines = lineCountOf(read)
      if (lines !== null) untracked.set(place, lines)
    }

    const files = G.filesOf(rows, G.parseNumstat(numstat.out), untracked)
    const next: G.GitState = {
      ...git,
      isRepo: true,
      branch: branch.ok ? branch.out.trim() : '',
      head: headHash,
      files,
      added: files.reduce((sum, file) => sum + file.added, 0),
      removed: files.reduce((sum, file) => sum + file.removed, 0),
      checkedAt: now,
      ...bookFields(),
    }

    const isMoved = headHash !== git.head
    if (isMoved || isHeavy || now - lastHeavyAt > 60_000) {
      lastHeavyAt = now
      const [log, upstream, aheadBehind, todayCount, todayStat, sessionCount] = await Promise.all([
        run(G.argv.log(30)),
        run(G.argv.upstream),
        run(G.argv.aheadBehind),
        run(G.argv.countSince('midnight')),
        run(G.argv.statSince('midnight')),
        run(G.argv.countSince(G.sinceOf(currentData().startedAt - 60_000))),
      ])
      const [behind = 0, ahead = 0] = aheadBehind.ok ? aheadBehind.out.trim().split(/\s+/).map(Number) : [0, 0]
      next.commits = log.ok ? G.parseLog(log.out) : []
      next.upstream = upstream.ok ? upstream.out.trim() : ''
      next.ahead = Number.isFinite(ahead) ? ahead : 0
      next.behind = Number.isFinite(behind) ? behind : 0
      next.today = { commits: todayCount.ok ? Number(todayCount.out.trim()) || 0 : 0, ...(todayStat.ok ? G.sumShortstats(todayStat.out) : { added: 0, removed: 0 }) }
      next.sessionCommits = sessionCount.ok ? Number(sessionCount.out.trim()) || 0 : 0
    }

    git = next
    if (currentView().file && currentView().v2.tab === 'changes') void loadFileDiff($, currentView().file)
  } finally {
    isGitBusy = false
    savePin($)
    lastGitAt = await $.clock.now()
    redrawIfChanged($, lastGitAt)
    if (isGitQueued) {
      isGitQueued = false
      scheduleGit($, 300)
    }
  }
  void readGitDiffs($)
}

/** The most untracked files whose whole text one read of git's diffs takes. */
const GIT_DIFF_UNTRACKED = 30

/** One read of git's diffs at a time; another asked for meanwhile runs after it. */
const gitDiffRead = { isBusy: false, isQueued: false }

/**
 * Git's own diff of each uncommitted file, while the web deck is on (none
 * otherwise): one `git diff` against HEAD for the tracked files, split per
 * file, and the whole text of the first 30 untracked ones. A binary file, or
 * one past `W.GIT_DIFF_MOST`, has none. Kept (and the state redrawn) only
 * when one changed, and only for the repository the deck still shows.
 */
export async function readGitDiffs($: EngineInterface): Promise<void> {
  if (!isSharing() || git.isRepo !== true || git.root === '') {
    if (gitDiffs.size > 0) gitDiffs = new Map()
    return
  }
  if (gitDiffRead.isBusy) {
    gitDiffRead.isQueued = true
    return
  }
  gitDiffRead.isBusy = true
  try {
    const { root, head, files } = git
    const next = new Map<string, { id: string; text: string }>()
    const keep = (path: string, hunks: readonly Hunk[]) => {
      const text = W.gitDiffTextOf(hunks)
      if (text !== '' && text.length <= W.GIT_DIFF_MOST) next.set(path, { id: W.gitDiffIdOf(path, text), text })
    }
    const tracked = files.filter(file => !file.isUntracked)
    if (tracked.length > 0) {
      const ran = await runGit($, G.argv.fileDiff(head ? 'HEAD' : G.EMPTY_TREE, []), 20_000, root)
      if (ran.ok) {
        for (const one of filePatchesOf(ran.out)) {
          const row = tracked.find(file => file.path === one.path)
          if (row && !one.isBinary) keep(row.path, hunksOf(one.text))
        }
      }
    }
    const places = files.filter(one => one.isUntracked).slice(0, GIT_DIFF_UNTRACKED).map(one => one.path)
    for (const [place, read] of await untrackedOf($, root, places, W.GIT_DIFF_MOST, W.GIT_DIFF_MOST)) {
      // a link shows as its target's path (git's own diff of one); its content, and a file outside the repository, are never read; one that cannot be read has no diff
      if (read.kind === 'link') keep(place, linkHunks(read.target))
      else if (read.kind === 'file' && read.text !== undefined) keep(place, addedFileHunks(read.text))
    }
    // read in a repository the deck has since left: not this one's
    if (!R.sameRoot(root, git.root)) return
    const isSame = next.size === gitDiffs.size && [...next].every(([path, one]) => gitDiffs.get(path)?.id === one.id)
    if (isSame) return
    gitDiffs = next
    redrawIfChanged($, await $.clock.now())
  } catch {
    // the diffs stand as they were
  } finally {
    gitDiffRead.isBusy = false
    if (gitDiffRead.isQueued) {
      gitDiffRead.isQueued = false
      void readGitDiffs($)
    }
  }
}

export async function loadFileDiff($: EngineInterface, path: string): Promise<void> {
  const { root, head } = git
  const row = git.files.find(file => file.path === path)
  const now = await $.clock.now()
  let found: G.FileDiff

  if (!row) {
    found = { path, hunks: [], isBinary: false, note: 'This file has no uncommitted changes any more.', at: now }
  } else if (row.isUntracked) {
    let read: UntrackedRead = { kind: 'gone' }
    try {
      read = (await untrackedOf($, root, [path], 2_000_000, 2_000_000)).get(path) ?? read
    } catch {
      // a file that cannot be read says so
    }
    if (read.kind === 'link') {
      // a link shows as its target's path, the way git shows one (its one line of diff); its content is never read
      found = { path, hunks: linkHunks(read.target), isBinary: false, at: now }
    } else if (read.kind === 'outside') {
      found = { path, hunks: [], isBinary: false, note: 'This file lies outside the repository.', at: now }
    } else if (read.kind === 'big' || (read.kind === 'file' && read.text === undefined)) {
      found = { path, hunks: [], isBinary: false, note: `New file, ${Math.round(read.size / 1024)} KB: too big to show.`, at: now }
    } else if (read.kind === 'binary') {
      found = { path, hunks: [], isBinary: true, at: now }
    } else if (read.kind === 'file') {
      found = { path, hunks: addedFileHunks(read.text ?? ''), isBinary: false, at: now }
    } else {
      found = { path, hunks: [], isBinary: false, note: isNodeMissing ? 'Could not read this new file: Apiarius reads new files with Node.js, which is not on PATH.' : 'Could not read this new file.', at: now }
    }
  } else {
    const paths = row.oldPath ? [row.oldPath, path] : [path]
    const ran = await runGit($, G.argv.fileDiff(head ? 'HEAD' : G.EMPTY_TREE, paths), 15_000, root)
    found = {
      path,
      hunks: hunksOf(ran.out),
      isBinary: /^Binary files /m.test(ran.out),
      at: now,
      ...(ran.ok ? {} : { note: F.trunc(ran.err.trim() || 'git diff failed', 200) }),
    }
  }

  // a diff read in the repository the deck has since left stays unshown
  if (!R.sameRoot(root, git.root)) return
  const isSame = fileDiff !== null && sameFileDiff(fileDiff, found)
  fileDiff = found
  if (!isSame) redraw($)
}

/** Whether two reads of a file's diff show the same; when each was read does not count. */
function sameFileDiff(a: G.FileDiff, b: G.FileDiff): boolean {
  return a.path === b.path && a.isBinary === b.isBinary && a.note === b.note && JSON.stringify(a.hunks) === JSON.stringify(b.hunks)
}

export async function loadCommit($: EngineInterface, hash: string): Promise<void> {
  const root = git.root
  // git is handed a commit's name as git printed it, never anything it could read as an option
  if (!G.isHash(hash)) return
  const [meta, numstat, patch] = await Promise.all([
    runGit($, G.argv.showMeta(hash), 15_000, root),
    runGit($, G.argv.showNumstat(hash), 15_000, root),
    runGit($, G.argv.showPatch(hash), 30_000, root),
  ])

  if (currentView().commit !== hash || !R.sameRoot(root, git.root)) return
  if (!meta.ok) {
    commit = null
    $.ui.toast(`Could not read commit ${hash.slice(0, 7)}`)
    return
  }

  const cap = 160_000
  commit = {
    ...G.parseMeta(meta.out),
    hash,
    files: G.parseNumstat(numstat.out),
    patch: patch.out.slice(0, cap),
    isPatchCut: patch.out.length > cap,
  }
  redraw($)
}
