/**
 * Repositories: which git repository each directory agents edit in belongs
 * to, and the one the deck follows: the one the person pinned, else the one
 * an agent edited last, else the session's own.
 *
 * Pure: the hooks module probes each new directory once (`git rev-parse
 * --show-toplevel` run there) and keeps the one live book. A path with a
 * drive letter compares as Windows compares it: either slash, any case.
 */
import { baseName } from './format'
import type { GitRepo } from './git'
import { relOf } from './model'

export type RepoBook = {
  /** The session's working directory. */
  cwd: string
  /** The root of the repository holding `cwd`: '' outside one, null until probed. */
  cwdRoot: string | null
  /** The root the person pinned the deck to; '' to follow the work. */
  pinned: string
  /** Each directory probed, by key: the root of the repository holding it, null outside any. */
  dirs: Map<string, string | null>
  /** Directories edited in and not probed yet, by key: the directory and its last edit. */
  pending: Map<string, { dir: string; at: number }>
  /** Directories probed and found outside any repository, by key, with their last edit: probed again after a `git init`. */
  outside: Map<string, { dir: string; at: number }>
  /** Each repository found, by key: its root as git prints it and the last edit in it (0 for none). */
  repos: Map<string, { root: string; lastEditAt: number }>
}

/** One directory to run `git rev-parse --show-toplevel` in, and why. */
export type Probe = { kind: 'cwd' | 'pin' | 'dir'; dir: string }

const DRIVE = /^[a-zA-Z]:(\/|$)/
const BARE_DRIVE = /^[a-zA-Z]:$/

export function emptyBook(cwd = ''): RepoBook {
  return { cwd, cwdRoot: null, pinned: '', dirs: new Map(), pending: new Map(), outside: new Map(), repos: new Map() }
}

/** Forward slashes and no trailing slash, a root kept whole (`/`, `C:/`). */
export function cleanPath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const trimmed = slashed.replace(/\/+$/, '')
  if (trimmed === '') return slashed.startsWith('/') ? '/' : ''
  return BARE_DRIVE.test(trimmed) ? `${trimmed}/` : trimmed
}

/** What every spelling of one path shares: `cleanPath`, lower-cased under a drive letter. */
export function keyOf(path: string): string {
  const clean = cleanPath(path)
  return DRIVE.test(clean) ? clean.toLowerCase() : clean
}

export function sameRoot(a: string, b: string): boolean {
  return keyOf(a) === keyOf(b)
}

/** Whether `path` starts at the top of a file system rather than in some directory. */
export function isAbsolute(path: string): boolean {
  return /^([a-zA-Z]:)?[\\/]/.test(path)
}

/** The directory holding `file`: `.` (the session's) for a bare name. */
export function dirOf(file: string): string {
  const clean = cleanPath(file)
  const cut = clean.lastIndexOf('/')
  if (cut < 0) return '.'
  if (cut === 0) return '/'
  const dir = clean.slice(0, cut)
  return BARE_DRIVE.test(dir) ? `${dir}/` : dir
}

/** The root `git rev-parse --show-toplevel` printed, its newline cut; '' when it printed none. */
export function rootOf(stdout: string): string {
  const line = stdout.split(/\r?\n/)[0] ?? ''
  return line.trim() === '' ? '' : cleanPath(line)
}

function repoAt(book: RepoBook, root: string): { root: string; lastEditAt: number } {
  const key = keyOf(root)
  const found = book.repos.get(key)
  if (found) return found
  const made = { root: cleanPath(root), lastEditAt: 0 }
  book.repos.set(key, made)
  return made
}

/** What the book knows of `dir`: the root holding it, null outside any, undefined until probed. */
export function lookup(book: RepoBook, dir: string): string | null | undefined {
  const key = keyOf(dir)
  return book.repos.get(key)?.root ?? book.dirs.get(key)
}

/** Points the book at the session's directory; a new one is probed again. */
export function setCwd(book: RepoBook, cwd: string): void {
  if (keyOf(cwd) === keyOf(book.cwd)) return
  book.cwd = cwd
  book.cwdRoot = null
}

/** Notes an agent's edit of `file` at `at`: the last edit of its repository, or its directory to probe. */
export function noteEdit(book: RepoBook, file: string, at: number): void {
  const dir = dirOf(file)
  const key = keyOf(dir)
  if (book.dirs.has(key)) {
    const root = book.dirs.get(key)
    const known = root ? repoAt(book, root) : book.outside.get(key)
    if (root && known && 'lastEditAt' in known) known.lastEditAt = Math.max(known.lastEditAt, at)
    else if (known && 'at' in known) known.at = Math.max(known.at, at)
    return
  }
  const waiting = book.pending.get(key)
  if (waiting) waiting.at = Math.max(waiting.at, at)
  else book.pending.set(key, { dir, at })
}

/** The directories still to probe: the session's until it has been, a pin not yet confirmed, each edited one once. */
export function probesOf(book: RepoBook): Probe[] {
  const probes: Probe[] = []
  const cwdKey = book.cwdRoot === null ? keyOf(book.cwd || '.') : null
  if (cwdKey !== null) probes.push({ kind: 'cwd', dir: book.cwd })
  if (book.pinned && !book.repos.has(keyOf(book.pinned))) probes.push({ kind: 'pin', dir: book.pinned })
  for (const [key, { dir }] of book.pending) if (key !== cwdKey) probes.push({ kind: 'dir', dir })
  return probes
}

/** Records a probe of `dir`: the root of the repository holding it, or null outside any. */
export function settleDir(book: RepoBook, dir: string, root: string | null): void {
  const key = keyOf(dir)
  const found = root ? cleanPath(root) : null
  const waiting = book.pending.get(key)
  book.pending.delete(key)
  book.dirs.set(key, found)
  if (!found) {
    const at = Math.max(waiting?.at ?? 0, book.outside.get(key)?.at ?? 0)
    book.outside.set(key, { dir: waiting?.dir ?? dir, at })
    return
  }
  book.outside.delete(key)
  const repo = repoAt(book, found)
  if (waiting) repo.lastEditAt = Math.max(repo.lastEditAt, waiting.at)
}

/** Records what a probe found; one the session or the person has moved past since only fills the cache. */
export function settle(book: RepoBook, probe: Probe, root: string | null): void {
  const found = root ? cleanPath(root) : ''
  if (probe.kind === 'cwd' && keyOf(probe.dir) === keyOf(book.cwd)) book.cwdRoot = found
  if (probe.kind === 'pin' && book.pinned !== '' && keyOf(probe.dir) === keyOf(book.pinned)) book.pinned = found
  settleDir(book, probe.dir || '.', root)
}

/** Forgets which directories lay outside any repository (a `git init` may have made one), so each is probed again. */
export function forgetOutside(book: RepoBook): void {
  for (const [key, { dir, at }] of book.outside) {
    book.dirs.delete(key)
    const waiting = book.pending.get(key)
    if (waiting) waiting.at = Math.max(waiting.at, at)
    else book.pending.set(key, { dir, at })
  }
  book.outside.clear()
  if (book.cwdRoot === '') book.cwdRoot = null
}

/** Forgets a repository that is gone: its directories are probed again on their next edit, a pin on it dropped. */
export function dropRepo(book: RepoBook, root: string): void {
  const key = keyOf(root)
  book.repos.delete(key)
  for (const [dir, found] of [...book.dirs]) if (found !== null && keyOf(found) === key) book.dirs.delete(dir)
  if (book.cwdRoot && keyOf(book.cwdRoot) === key) book.cwdRoot = null
  if (book.pinned && keyOf(book.pinned) === key) book.pinned = ''
}

/** The root the deck shows: the pinned one, else the one edited last, else the session's; '' for none. */
export function activeRoot(book: RepoBook): string {
  if (book.pinned) return book.repos.get(keyOf(book.pinned))?.root ?? book.pinned
  let last: { root: string; lastEditAt: number } | undefined
  for (const repo of book.repos.values()) if (repo.lastEditAt > 0 && (!last || repo.lastEditAt > last.lastEditAt)) last = repo
  return last?.root ?? book.cwdRoot ?? ''
}

/** Every repository found, for a picker: the one edited last first, then the session's, then by name. */
export function repoList(book: RepoBook): GitRepo[] {
  const cwdKey = book.cwdRoot ? keyOf(book.cwdRoot) : ''
  return [...book.repos.entries()]
    .map(([key, repo]) => ({ root: repo.root, name: baseName(repo.root), lastEditAt: repo.lastEditAt, isCwd: key === cwdKey }))
    .sort((a, b) => b.lastEditAt - a.lastEditAt || Number(b.isCwd) - Number(a.isCwd) || a.name.localeCompare(b.name))
}

/** A display path made against `from` (or absolute) shown against `to`: relative inside it, absolute elsewhere. */
export function rerootPath(path: string, from: string, to: string): string {
  const abs = isAbsolute(path) || from === '' ? path : `${cleanPath(from).replace(/\/$/, '')}/${path}`
  return relOf(abs, to || null)
}

/** The root the edits' relative paths were made against, read off the first edit that has one; '' for none. */
export function rootOfEdits(edits: readonly { path: string; abs: string }[]): string {
  for (const edit of edits) {
    if (edit.path === '' || edit.path === '.' || isAbsolute(edit.path)) continue
    const abs = cleanPath(edit.abs)
    const tail = `/${cleanPath(edit.path)}`
    const isCaseless = DRIVE.test(abs)
    const a = isCaseless ? abs.toLowerCase() : abs
    const t = isCaseless ? tail.toLowerCase() : tail
    if (a.endsWith(t)) return cleanPath(abs.slice(0, abs.length - tail.length) || '/')
  }
  return ''
}
