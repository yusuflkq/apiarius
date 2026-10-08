/**
 * Git: the argument vectors the deck runs (no shell, no optional locks, no
 * external diff drivers, C locale) and the parsers for what they print.
 *
 * Pure: the hooks module runs these through `$.process.run`.
 */
import type { Hunk } from './diff'

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export const GIT_ENV: Record<string, string> = {
  LC_ALL: 'C',
  LANGUAGE: '',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: 'cat',
  GIT_TERMINAL_PROMPT: '0',
}

const G = [
  'git',
  '--no-optional-locks',
  '-c',
  'core.quotePath=false',
  '-c',
  'diff.relative=false',
  '-c',
  'color.ui=false',
] as const

const DIFF = ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty'] as const

export const argv = {
  toplevel: [...G, 'rev-parse', '--show-toplevel'],
  branch: [...G, 'rev-parse', '--abbrev-ref', 'HEAD'],
  head: [...G, 'rev-parse', '--verify', '--quiet', 'HEAD'],
  upstream: [...G, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
  aheadBehind: [...G, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
  status: [...G, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
  numstat: (base: string) => [...G, ...DIFF, '--numstat', '-z', base, '--'],
  fileDiff: (base: string, paths: readonly string[]) => [...G, ...DIFF, '-M', '-U3', base, '--', ...paths],
  log: (count: number) => [
    ...G,
    'log',
    `-n${count}`,
    '--date=unix',
    '--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%at%x1f%s',
    '--shortstat',
  ],
  countSince: (since: string) => [...G, 'rev-list', '--count', `--since=${since}`, 'HEAD'],
  statSince: (since: string) => [...G, 'log', `--since=${since}`, '--pretty=format:%x1e', '--shortstat'],
  showMeta: (hash: string) => [...G, 'show', '-s', '--format=%H%x1f%an%x1f%ae%x1f%at%x1f%B', hash],
  showNumstat: (hash: string) => [...G, 'show', '--no-ext-diff', '--no-textconv', '--format=', '--numstat', '-z', hash],
  showPatch: (hash: string) => [...G, 'show', '--no-ext-diff', '--no-textconv', '--format=', '-U3', hash],
  newSince: (from: string) => [...G, 'rev-list', '-n', '40', `${from}..HEAD`],
  recentHashes: [...G, 'rev-list', '-n', '5', 'HEAD'],
}

export type FileCode = 'M' | 'A' | 'D' | 'R' | 'N' | '!' | 'T'

export type FileRow = {
  path: string
  oldPath?: string
  code: FileCode
  isStaged: boolean
  isUnstaged: boolean
  isUntracked: boolean
  isBinary: boolean
  added: number
  removed: number
}

export type Commit = {
  hash: string
  short: string
  author: string
  at: number
  subject: string
  files: number
  added: number
  removed: number
}

export type CommitDetail = {
  hash: string
  author: string
  email: string
  at: number
  body: string
  files: { path: string; oldPath?: string; added: number; removed: number; isBinary: boolean }[]
  patch: string
  isPatchCut: boolean
}

export type FileDiff = {
  path: string
  hunks: Hunk[]
  isBinary: boolean
  note?: string
  at: number
}

/**
 * A repository the deck can show: the session's own, or one an agent edited
 * a file in. `root` is the top level as git prints it (`C:/Users/...` on
 * Windows), `name` its last segment, `lastEditAt` the time of the last edit
 * an agent made in it (0 for none yet), `isCwd` whether it holds the
 * session's working directory.
 */
export type GitRepo = { root: string; name: string; lastEditAt: number; isCwd: boolean }

export type GitState = {
  isRepo: boolean | null
  /** The repository shown (every git command runs there); '' for none. */
  root: string
  branch: string
  head: string
  upstream: string
  ahead: number
  behind: number
  files: FileRow[]
  added: number
  removed: number
  commits: Commit[]
  today: { commits: number; added: number; removed: number }
  sessionCommits: number
  checkedAt: number
  error?: string
  /** Every repository found so far, the one edited last first. */
  repos: GitRepo[]
  /** The root the person pinned the deck to; '' while it follows the work. */
  pinned: string
}

export function emptyGit(): GitState {
  return {
    isRepo: null,
    root: '',
    branch: '',
    head: '',
    upstream: '',
    ahead: 0,
    behind: 0,
    files: [],
    added: 0,
    removed: 0,
    commits: [],
    today: { commits: 0, added: 0, removed: 0 },
    sessionCommits: 0,
    checkedAt: 0,
    repos: [],
    pinned: '',
  }
}

export type StatusRow = { x: string; y: string; path: string; oldPath?: string }

export function parseStatus(out: string): StatusRow[] {
  const parts = out.split('\0')
  const rows: StatusRow[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part || part.length < 4) continue
    const x = part[0] ?? ' '
    const y = part[1] ?? ' '
    const path = part.slice(3)
    let oldPath: string | undefined
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i += 1
      oldPath = parts[i]
    }
    rows.push({ x, y, path, ...(oldPath ? { oldPath } : {}) })
  }

  return rows
}

export type NumstatRow = { path: string; oldPath?: string; added: number; removed: number; isBinary: boolean }

export function parseNumstat(out: string): NumstatRow[] {
  const parts = out.split('\0')
  const rows: NumstatRow[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = (parts[i] ?? '').replace(/^\n+/, '')
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(part)
    if (!match) continue
    let path = match[3] ?? ''
    let oldPath: string | undefined
    if (path === '') {
      oldPath = parts[i + 1]
      path = parts[i + 2] ?? ''
      i += 2
    }
    const isBinary = match[1] === '-'
    rows.push({
      path,
      ...(oldPath ? { oldPath } : {}),
      added: isBinary ? 0 : Number(match[1]),
      removed: isBinary ? 0 : Number(match[2]),
      isBinary,
    })
  }

  return rows
}

function codeOf(row: StatusRow): FileCode {
  const { x, y } = row
  if (x === '?') return 'N'
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return '!'
  if (x === 'R' || y === 'R' || x === 'C') return 'R'
  if (x === 'A') return 'A'
  if (x === 'D' || y === 'D') return 'D'
  if (x === 'T' || y === 'T') return 'T'
  return 'M'
}

/** Joins `git status` with the numstat against the base, untracked files' line counts added. */
export function filesOf(status: readonly StatusRow[], numstat: readonly NumstatRow[], untrackedLines: ReadonlyMap<string, number>): FileRow[] {
  const counts = new Map(numstat.map(row => [row.path, row]))

  const rows = status.map((row): FileRow => {
    const isUntracked = row.x === '?'
    const stat = counts.get(row.path)
    return {
      path: row.path,
      ...(row.oldPath ? { oldPath: row.oldPath } : {}),
      code: codeOf(row),
      isStaged: row.x !== ' ' && row.x !== '?',
      isUnstaged: row.y !== ' ' && row.y !== '?',
      isUntracked,
      isBinary: stat?.isBinary ?? false,
      added: isUntracked ? (untrackedLines.get(row.path) ?? 0) : (stat?.added ?? 0),
      removed: isUntracked ? 0 : (stat?.removed ?? 0),
    }
  })

  return rows.sort((a, b) => b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path))
}

export function parseShortstat(text: string): { files: number; added: number; removed: number } {
  const files = /(\d+) files? changed/.exec(text)
  const added = /(\d+) insertions?\(\+\)/.exec(text)
  const removed = /(\d+) deletions?\(-\)/.exec(text)
  return {
    files: files ? Number(files[1]) : 0,
    added: added ? Number(added[1]) : 0,
    removed: removed ? Number(removed[1]) : 0,
  }
}

export function parseLog(out: string): Commit[] {
  return out
    .split('\x1e')
    .filter(chunk => chunk.trim() !== '')
    .map(chunk => {
      const [head = '', ...rest] = chunk.split('\n')
      const [hash = '', short = '', author = '', at = '0', subject = ''] = head.split('\x1f')
      return { hash, short, author, at: Number(at) * 1000, subject, ...parseShortstat(rest.join('\n')) }
    })
    .filter(commit => commit.hash !== '')
}

export function sumShortstats(out: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const chunk of out.split('\x1e')) {
    const stat = parseShortstat(chunk)
    added += stat.added
    removed += stat.removed
  }
  return { added, removed }
}

export function parseMeta(out: string): Pick<CommitDetail, 'hash' | 'author' | 'email' | 'at' | 'body'> {
  const [hash = '', author = '', email = '', at = '0', ...body] = out.split('\x1f')
  return { hash: hash.trim(), author, email, at: Number(at) * 1000, body: body.join('\x1f').trim() }
}

/** `git log --since` takes this spelling of a moment in every locale. */
export function sinceOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`
}

/** True for a shell command that may have made a commit. */
export function mayCommit(command: string): boolean {
  return /\bgit\b[^\n|;&]*\b(commit|merge|cherry-pick|revert|rebase|am|pull)\b/.test(command)
}

/** True for a shell command that may have changed the working tree or index. */
export function mayChangeTree(command: string): boolean {
  return !/^\s*(git\s+(status|log|diff|show|branch|rev-parse|remote|fetch)\b|ls\b|dir\b|cat\b|type\b|echo\b|pwd\b|Get-ChildItem\b|Get-Content\b)/i.test(command)
}
