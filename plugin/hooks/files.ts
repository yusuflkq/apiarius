/**
 * Files read through web/files.js, which opens each without following a
 * symbolic link anywhere on the way (the engine's own `$.fs.read` follows
 * links, so a file swapped for a link between a look and the read would
 * hand over the link's target): a repository's untracked files and its
 * attribute files. Its request, its answer read back, and what the deck
 * keeps of each file between reads (`FileBook`: by its path, its size and
 * its time as `$.fs.stat` saw them before the read, so a refresh where
 * nothing moved runs no node at all).
 *
 * Pure: the hooks module runs the helper through `$.process.run`.
 */

/** What the helper is asked: the folder, the files by their place under it, the most bytes a file may hold to be read, and the most whose text comes back (0: its line count alone). */
export type FileRequest = { root: string; paths: string[]; most: number; textMost: number }

/** What the helper said of one file: a plain file (its size, lines, and text when asked and there was room), one with a NUL byte, one too big, none there, or one refused (a link on the way, no regular file, unreadable). */
export type FileRead =
  | { kind: 'file'; size: number; lines: number; text?: string }
  | { kind: 'binary'; size: number }
  | { kind: 'big'; size: number }
  | { kind: 'none' }
  | { kind: 'refused'; why: string }

/** The most files one run of the helper takes (web/files.js MOST_PATHS). */
export const MOST_PATHS = 64

/** The helper's command line: node and web/files.js; the request goes on its stdin (`requestTextOf`). */
export function filesArgvOf(script: string): string[] {
  return ['node', script]
}

/** The request as the helper reads it on stdin. */
export function requestTextOf(request: FileRequest): string {
  return JSON.stringify(request)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0

/** One file's answer, checked; a shape the helper never prints reads as refused. */
function readOf(value: unknown): FileRead {
  if (!isRecord(value)) return { kind: 'refused', why: 'unreadable' }
  if (value.kind === 'file' && isCount(value.size) && isCount(value.lines)) return { kind: 'file', size: value.size, lines: value.lines, ...(typeof value.text === 'string' ? { text: value.text } : {}) }
  if ((value.kind === 'binary' || value.kind === 'big') && isCount(value.size)) return { kind: value.kind, size: value.size }
  if (value.kind === 'none') return { kind: 'none' }
  return { kind: 'refused', why: typeof value.why === 'string' ? value.why.slice(0, 80) : 'unreadable' }
}

/** What the helper answered, by each asked place; null when it said it could not (or printed anything else), so nothing is read. */
export function answerOf(stdout: string, paths: readonly string[]): Map<string, FileRead> | null {
  let said: unknown
  try {
    said = JSON.parse(stdout.trim())
  } catch {
    return null
  }
  if (!isRecord(said) || said.ok !== true || !Array.isArray(said.files) || said.files.length !== paths.length) return null
  const files = said.files as unknown[]
  const out = new Map<string, FileRead>()
  paths.forEach((place, i) => {
    const one = files[i]
    // in the request's order, each naming its own place
    out.set(place, isRecord(one) && one.path === place ? readOf(one) : { kind: 'refused', why: 'unreadable' })
  })
  return out
}

/** A file as last read, by its path: its size and time as `$.fs.stat` saw them just before, and what came of the read. */
export type Kept = { size: number; mtimeMs: number; read: FileRead }
/** The files kept between reads, by their absolute path, the one read last last. */
export type FileBook = Map<string, Kept>

/** The most files kept, and the most characters of text kept in all: past either the oldest go. */
const MOST_KEPT = 128
const MOST_KEPT_TEXT = 8_000_000

/** What was read of `abs` while it stood as it stands now (`size`, `mtimeMs`), when that answers a read asking for text up to `textMost`; undefined to read it again. */
export function keptOf(book: FileBook, abs: string, size: number, mtimeMs: number, textMost: number): FileRead | undefined {
  const kept = book.get(abs)
  if (!kept || kept.size !== size || kept.mtimeMs !== mtimeMs) return undefined
  // its text was not read then (not asked for, or no room), and is now
  if (kept.read.kind === 'file' && kept.read.text === undefined && kept.read.size <= textMost) return undefined
  return kept.read
}

/** Keeps what was read of `abs` while it stood at `size`, `mtimeMs`: a plain file's or a binary one's (anything else is read again next time); the oldest let go past the caps. */
export function keep(book: FileBook, abs: string, size: number, mtimeMs: number, read: FileRead): void {
  book.delete(abs)
  if (read.kind !== 'file' && read.kind !== 'binary') return
  book.set(abs, { size, mtimeMs, read })
  let text = 0
  for (const one of book.values()) text += one.read.kind === 'file' ? (one.read.text?.length ?? 0) : 0
  for (const [key, one] of book) {
    if (book.size <= MOST_KEPT && text <= MOST_KEPT_TEXT) break
    if (key === abs) continue
    text -= one.read.kind === 'file' ? (one.read.text?.length ?? 0) : 0
    book.delete(key)
  }
}
