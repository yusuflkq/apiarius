/**
 * Git: the argument vectors the deck runs (no shell, no optional locks, no
 * external diff drivers, C locale) and the parsers for what they print.
 *
 * The deck runs git every few seconds in repositories an agent edits in,
 * which may be anywhere on the disk, so nothing a repository's own settings
 * name ever runs: no file-system monitor, no signature check, no submodule's
 * own git, no remote reached (a partial clone's lazy fetch runs its remote's
 * command), no external diff or text conversion (on every command that diffs),
 * and no filter driver the repository's own config defines (`repoConfigOf`:
 * read before every run, each such driver switched off, or, where the
 * person's own global config defines one by that name, set back to theirs).
 * The person's global and system config stay trusted: a global git-lfs
 * filter keeps working. Each command runs with `-C <repository>` from the
 * session's own folder (`argvIn`), never with the repository as its working
 * folder, so a program a repository holds is never the one found by name.
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
  // a partial clone fetches what it lacks from its remote, whose command its own config names: never
  GIT_NO_LAZY_FETCH: '1',
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
  // what a repository's own config could run: none of it
  '-c',
  'core.fsmonitor=',
  '-c',
  'log.showSignature=false',
  '-c',
  'submodule.recurse=false',
  '-c',
  'diff.submodule=short',
  '-c',
  'status.submoduleSummary=false',
  // no remote is ever reached (an older git's lazy fetch included), whatever its config allows
  '-c',
  'protocol.allow=never',
  ...['file', 'git', 'ssh', 'http', 'https', 'ext'].flatMap(name => ['-c', `protocol.${name}.allow=never`]),
] as const

/** Every command that diffs: no external diff, no text conversion, no submodule's own git. */
const NO_DRIVERS = ['--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty'] as const

const DIFF = ['diff', ...NO_DRIVERS] as const

export const argv = {
  toplevel: [...G, 'rev-parse', '--show-toplevel'],
  branch: [...G, 'rev-parse', '--abbrev-ref', 'HEAD'],
  head: [...G, 'rev-parse', '--verify', '--quiet', 'HEAD'],
  upstream: [...G, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
  aheadBehind: [...G, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
  status: [...G, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=dirty'],
  numstat: (base: string) => [...G, ...DIFF, '--numstat', '-z', base, '--'],
  fileDiff: (base: string, paths: readonly string[]) => [...G, ...DIFF, '-M', '-U3', base, '--', ...paths],
  log: (count: number) => [
    ...G,
    'log',
    `-n${count}`,
    ...NO_DRIVERS,
    '--date=unix',
    '--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%at%x1f%s',
    '--shortstat',
  ],
  countSince: (since: string) => [...G, 'rev-list', '--count', `--since=${since}`, 'HEAD'],
  statSince: (since: string) => [...G, 'log', `--since=${since}`, ...NO_DRIVERS, '--pretty=format:%x1e', '--shortstat'],
  showMeta: (hash: string) => [...G, 'show', '-s', ...NO_DRIVERS, '--format=%H%x1f%an%x1f%ae%x1f%at%x1f%B', hash],
  showNumstat: (hash: string) => [...G, 'show', ...NO_DRIVERS, '--format=', '--numstat', '-z', hash],
  showPatch: (hash: string) => [...G, 'show', ...NO_DRIVERS, '--format=', '-U3', hash],
  newSince: (from: string) => [...G, 'rev-list', '-n', '40', `${from}..HEAD`],
  recentHashes: [...G, 'rev-list', '-n', '5', 'HEAD'],
  /** Every setting git reads there, each with where it came from (`repoConfigOf` reads it). */
  config: [...G, 'config', '--list', '--show-scope', '-z'],
  /** Every `.gitattributes` the index holds, or the working tree has outside what it ignores (`ls-files` reads no file's content: no filter runs). */
  attrFiles: [...G, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/.gitattributes'],
  /** Every ignored `.gitattributes` in a folder git still walks (one holding a tracked file); a folder wholly ignored and untracked shows as itself, and no tracked file in it has attributes to read. */
  ignoredAttrFiles: [...G, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--', ':(glob)**/.gitattributes'],
  /** Where git reads the repository's `info/attributes` (a worktree's is its main repository's). */
  infoAttributes: [...G, 'rev-parse', '--git-path', 'info/attributes'],
  /** A tracked `.gitattributes` as the index holds it, for one gone from the working tree (git reads the index's then); `cat-file` runs no filter. */
  indexBlob: (place: string) => [...G, 'cat-file', 'blob', `:${place}`],
}

/** Whether a command reads the working tree's files (`status`, `diff`), the only ones a filter driver can run on: before one, the deck reads every attribute file too, and after it whether the repository's filter settings moved. */
export function readsWorktree(args: readonly string[]): boolean {
  const sub = args[G.length]
  return sub === 'status' || sub === 'diff'
}

/** The most attribute files the deck reads in a repository: past it, it runs no git there. */
export const MOST_ATTR_FILES = 256

/** The most bytes an attribute file may hold: past it, the deck runs no git there. */
export const MOST_ATTR_BYTES = 256 * 1024

/** The places of a repository's in-tree attribute files, from `argv.attrFiles` and `argv.ignoredAttrFiles` (git's own `-z` lists, relative to the repository's top): each once, a folder git showed whole left out. */
export function attrPlacesOf(...lists: readonly string[]): string[] {
  const places = new Set<string>()
  for (const list of lists) {
    for (const place of list.split('\0')) {
      if (place === '' || place.endsWith('/') || !(place === '.gitattributes' || place.endsWith('/.gitattributes'))) continue
      places.add(place)
    }
  }
  return [...places]
}

/**
 * Where an attribute file a repository's own config names lies
 * (`core.attributesFile`, local or worktree scope, `localAttributesFileOf`),
 * as git reads it in `where` (its top level, where git runs): `~/` under the
 * person's `home`, a relative one under `where`, an absolute one as it is;
 * '' for none. One the deck cannot place as git would (`~name/`, a
 * `%(prefix)/` path, `~/` with no home known) is a refusal.
 */
export function attributesFileOf(listing: string, where: string, home: string): string | { refusal: string } {
  const named = localAttributesFileOf(listing).trim()
  if (named === '') return ''
  const cannot = { refusal: `This repository's own git settings name an attribute file Apiarius cannot place (${JSON.stringify(shownOf(named).slice(0, 60))}), so it runs no git there.` }
  if (named.startsWith('~/') || named.startsWith('~\\')) return home.trim() === '' ? cannot : `${home.replace(/[\\/]+$/, '')}/${named.slice(2)}`
  if (named.startsWith('~') || named.startsWith('%(')) return cannot
  if (/^(?:[\\/]|[A-Za-z]:[\\/])/.test(named)) return named
  return `${where.replace(/[\\/]+$/, '')}/${named}`
}

/** Why the deck runs no git in a repository whose attribute file is a link, no plain file, too big or unreadable: it cannot tell which filters it names. */
export function attrRefusalOf(place: string): string {
  return `This repository's attribute file ${JSON.stringify(shownOf(place).slice(0, 60))} is a link, not a plain file, too big or unreadable, so Apiarius runs no git there.`
}

/** Why the deck runs no git in a repository again this session: its filter settings moved while a command of the deck's ran there. */
export const SETTINGS_MOVED = "This repository's git filter settings changed while Apiarius read it, so it runs no git there again this session."

/**
 * The settings that decide which filter runs, from `argv.config`'s listing:
 * every `filter.*` setting and `core.attributesFile`, each with its scope, in
 * git's order. The deck reads these before and after each command that reads
 * the working tree; when they moved, a definition came in while git ran
 * (the race), so that run's output is dropped and the repository refused.
 * Any other setting may move freely (a `git push -u` writes the branch's).
 */
export function filterSettingsOf(listing: string): string {
  const parts = listing.split('\0')
  const kept: string[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const entry = parts[i + 1] ?? ''
    const cut = entry.indexOf('\n')
    const key = (cut < 0 ? entry : entry.slice(0, cut)).toLowerCase()
    if (key.startsWith('filter.') || key === 'core.attributesfile') kept.push(`${parts[i] ?? ''}\0${entry}`)
  }
  return kept.join('\0')
}

/** Whether `hash` is a commit's name as git prints one (4 to 64 hex digits): the only thing `show` is ever handed. */
export function isHash(hash: string): boolean {
  return /^[0-9a-f]{4,64}$/i.test(hash)
}

/**
 * The argument vector that runs `args` (one of `argv`) in the repository
 * or folder `where`: git told to change there itself (`-C`), so the
 * process starts in the session's folder and a program inside `where` is
 * never found by name, then `overrides` (`repoConfigOf`'s), then its own.
 */
export function argvIn(args: readonly string[], where: string, overrides: readonly string[] = []): string[] {
  return ['git', '-C', where, ...overrides, ...args.slice(1)]
}

/** Where git read a setting from that the person stands behind: their system's, their own global one, and the command line (the deck's and Claude Code's own `-c`). Any other (the repository's own, its worktree's, what those include) is the repository's to say. */
const TRUSTED_SCOPES: ReadonlySet<string> = new Set(['system', 'global', 'command'])

/** A filter driver's settings git runs or obeys. */
const FILTER_KEYS = ['clean', 'smudge', 'process', 'required'] as const

/** A driver name the deck can name back to git on its command line (`-c filter.<name>.clean=`): one with an `=` or a space would be read as something else. */
const DRIVER_NAME = /^[A-Za-z0-9._@+-]{1,100}$/

/**
 * Every filter driver a repository's attribute files name (`filter=NAME`):
 * the drivers git would run on its files, as the attributes stand. The deck
 * blanks each of these too (`repoConfigOf`'s `attrNames`), so that a
 * repository cannot define a filter in its config *after* the deck read it
 * (a race the per-run config read alone would miss): with the driver blanked
 * on the command line, a late definition has nothing git will attach to.
 * A comment line (`#`) names none. A macro's own line (`[attr]m filter=NAME`)
 * names its driver, since a pattern line may set the macro; and a pattern
 * may itself start with `[` (`[ab]*.txt filter=NAME`). Every `filter=NAME`
 * token counts, so a token git would read as the pattern names one too (more
 * blanked, never fewer); `-filter`/`!filter` name none.
 */
export function attrFilterNamesOf(texts: readonly string[]): string[] {
  const names = new Set<string>()
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (line === '' || line.startsWith('#')) continue
      for (const match of line.matchAll(/(?:^|\s)filter=(\S+)/g)) {
        const name = match[1] ?? ''
        if (name !== '') names.add(name)
      }
    }
  }
  return [...names]
}

/** The `core.attributesFile` a repository's own config names (local or worktree scope, never the person's trusted one): the attribute file the deck reads too, for the filters it names; '' for none. */
export function localAttributesFileOf(listing: string): string {
  const parts = listing.split('\0')
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const scope = parts[i] ?? ''
    const entry = parts[i + 1] ?? ''
    const cut = entry.indexOf('\n')
    const key = cut < 0 ? entry : entry.slice(0, cut)
    if (key.toLowerCase() === 'core.attributesfile' && !TRUSTED_SCOPES.has(scope)) return cut < 0 ? '' : entry.slice(cut + 1)
  }
  return ''
}

/**
 * What the deck must tell git so that no filter driver a repository's own
 * config defines runs (its `clean`, `smudge` or `process`), from
 * `git config --list --show-scope -z` there (`argv.config`), and no driver
 * its attribute files name (`attrNames`, from `attrFilterNamesOf`) runs
 * either: each setting of a driver that came from outside the person's
 * trusted scopes is set back to what their own config says (a global
 * git-lfs keeps working), or blanked where theirs says none; a driver an
 * attribute names is blanked whole (`clean`, `smudge` and `process`), so a
 * definition the repository writes into its config after this read has
 * nothing to attach to (a race). A driver left with nothing of the person's
 * to run (none of theirs by that name, or a `process` of the repository's,
 * which the command line can blank but not unset, beside a `clean` of
 * theirs) is switched off, `required` false so git reads the files as they
 * stand, and, where the repository's own config defined it, named in
 * `drivers` (for a note). A repository defining or naming a driver whose
 * name the command line cannot carry is refused: nothing runs there.
 */
export function repoConfigOf(listing: string, attrNames: readonly string[] = []): { overrides: string[]; drivers: string[] } | { refusal: string } {
  const parts = listing.split('\0')
  const trusted = new Map<string, string>()
  const untrusted = new Map<string, Set<string>>()
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const scope = parts[i] ?? ''
    const entry = parts[i + 1] ?? ''
    const cut = entry.indexOf('\n')
    const key = cut < 0 ? entry : entry.slice(0, cut)
    const value = cut < 0 ? 'true' : entry.slice(cut + 1)
    const match = /^filter\.(.+)\.([^.]+)$/i.exec(key)
    if (!match) continue
    const name = match[1] ?? ''
    const what = (match[2] ?? '').toLowerCase()
    if (!(FILTER_KEYS as readonly string[]).includes(what)) continue
    if (TRUSTED_SCOPES.has(scope)) trusted.set(`${name}\n${what}`, value)
    else untrusted.set(name, (untrusted.get(name) ?? new Set<string>()).add(what))
  }
  // every driver to neutralise: the repository's config-defined ones, and the ones its attributes name (which its config may define only later)
  const names = new Set<string>([...untrusted.keys(), ...attrNames])
  const overrides: string[] = []
  const drivers: string[] = []
  for (const name of [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!DRIVER_NAME.test(name)) return { refusal: `This repository's own git settings define a filter Apiarius cannot switch off (${JSON.stringify(name.slice(0, 40))}), so it runs no git there.` }
    const said = untrusted.get(name) ?? new Set<string>()
    const own = (what: string) => trusted.get(`${name}\n${what}`)
    const isOwned = FILTER_KEYS.some(what => own(what) !== undefined)
    // an attribute names a driver the person does not define: blank every key the command line can, whatever the config says now or writes later (the race). A driver the person does define is restored to exactly theirs, not blanked (a blank `process` would stop a clean/smudge driver of theirs); the command line beats the repository's own scopes, so a late redefinition of theirs cannot win either.
    const wipe = attrNames.includes(name) && !isOwned
    const set = (what: string, value: string) => overrides.push('-c', `filter.${name}.${what}=${value}`)
    for (const what of ['clean', 'smudge', 'process']) {
      const value = own(what)
      if (value !== undefined) set(what, value)
      else if (wipe || said.has(what)) set(what, '')
    }
    // git runs a driver's process before its clean, and a blank one is no filter at all
    const isOff = own('process') === undefined && (wipe || said.has('process') || own('clean') === undefined)
    // the note is for a driver the repository's own config actually defines, not one merely named in its attributes
    if (isOff && said.size > 0) drivers.push(name)
    set('required', isOff ? 'false' : (own('required') ?? 'false'))
  }
  return { overrides, drivers }
}

/** What the deck says where git is too old to say where its settings come from (`--show-scope` came in 2.26): it runs none there. */
export const OLD_GIT = 'Apiarius needs git 2.26 or newer to read a repository without running what its own settings name.'

/** Why git could not say where its settings come from, in words for the person: an older git (`OLD_GIT`), else git's own first line. */
export function configRefusalOf(stderr: string): string {
  if (/show-scope/.test(stderr)) return OLD_GIT
  const first = stderr.split(/\r?\n/).find(line => line.trim() !== '') ?? ''
  return first.trim() || 'git could not read its settings here'
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
  /** Whether the session's own directory is in a repository; null until git was asked. */
  isCwdRepo: boolean | null
  /** While the session's directory is in none: the repositories directly inside it (each child's `.git`), the one changed last first, at most 8; [] otherwise. */
  nearby: { root: string; name: string }[]
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
    isCwdRepo: null,
    nearby: [],
  }
}

export type StatusRow = { x: string; y: string; path: string; oldPath?: string }

/**
 * What git printed of a repository's own (a path, with `-z` as it lies on
 * the disk; a commit's author, subject or message), as the deck keeps and
 * shows it: each control character (C0, DEL, C1; a message's newlines and
 * tabs kept, with `isLines`) and each bidirectional control (an override,
 * embedding, isolate or mark) as U+FFFD. What a repository chose then neither breaks a drawing
 * (every surface refuses a control character in text) nor reads in an
 * order other than its own; git, asked of such a path, finds no such file,
 * so it shows with no diff.
 */
export function shownOf(text: string, isLines = false): string {
  return text.replace(isLines ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g : /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '\ufffd')
}

export function parseStatus(out: string): StatusRow[] {
  const parts = out.split('\0')
  const rows: StatusRow[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part || part.length < 4) continue
    const x = part[0] ?? ' '
    const y = part[1] ?? ' '
    const path = shownOf(part.slice(3))
    let oldPath: string | undefined
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i += 1
      oldPath = parts[i] === undefined ? undefined : shownOf(parts[i] ?? '')
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
    let path = shownOf(match[3] ?? '')
    let oldPath: string | undefined
    if (path === '') {
      oldPath = parts[i + 1] === undefined ? undefined : shownOf(parts[i + 1] ?? '')
      path = shownOf(parts[i + 2] ?? '')
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
      // what a commit says is its author's to choose: one line each, no control character
      return { hash, short, author: shownOf(author), at: Number(at) * 1000, subject: shownOf(subject), ...parseShortstat(rest.join('\n')) }
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
  return { hash: hash.trim(), author: shownOf(author), email: shownOf(email), at: Number(at) * 1000, body: shownOf(body.join('\x1f'), true).trim() }
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
