/**
 * Unified-diff helpers: parse hunks, cut them to the Code element's limits
 * while keeping every header's counts true (so the cut still parses as a
 * diff), and split a multi-file patch into its files.
 */
import { clean } from './format'

export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: readonly string[]
}

export type FilePatch = { path: string; oldPath?: string; text: string; isBinary: boolean }

export type CodeSources = { sources: string[]; isCut: boolean; used: number }

/** The most characters one Code source may hold, under the host's 10 000. */
export const MAX_SOURCE_CHARS = 9000

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function hunksOf(text: string): Hunk[] {
  const out: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }[] = []
  let current: (typeof out)[number] | null = null

  for (const raw of text.split('\n')) {
    const line = clean(raw)
    const header = HEADER.exec(line)

    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      }
      out.push(current)
      continue
    }

    if (current === null || line === '') continue

    const lead = line[0]
    if (lead === '+' || lead === '-' || lead === ' ' || lead === '\\') {
      current.lines.push(line)
    } else if (line.startsWith('diff --git ')) {
      current = null
    }
  }

  return out.filter(hunk => hunk.lines.length > 0)
}

/** One hunk as unified text, its body cut to `maxChars` with true counts. */
export function hunkText(hunk: Hunk, maxChars = MAX_SOURCE_CHARS): { text: string; isCut: boolean } {
  const kept: string[] = []
  let size = 40
  let isCut = false

  for (const line of hunk.lines) {
    const piece = line.length > 600 ? `${line.slice(0, 600)}…` : line
    if (size + piece.length + 1 > maxChars) {
      isCut = true
      break
    }
    kept.push(piece)
    size += piece.length + 1
  }

  let oldCount = 0
  let newCount = 0
  for (const line of kept) {
    if (line[0] === ' ' || line[0] === '-') oldCount += 1
    if (line[0] === ' ' || line[0] === '+') newCount += 1
  }

  const isWhole = !isCut && oldCount === hunk.oldLines && newCount === hunk.newLines
  const header = `@@ -${hunk.oldStart},${isWhole ? hunk.oldLines : oldCount} +${hunk.newStart},${isWhole ? hunk.newLines : newCount} @@`

  return { text: [header, ...kept].join('\n'), isCut: isCut || !isWhole }
}

/**
 * Splits hunks into Code-sized sources, grouping small hunks together, until
 * `budget` characters are spent; `isCut` says something was left out.
 */
export function codeSourcesOf(hunks: readonly Hunk[], budget: number): CodeSources {
  const sources: string[] = []
  let pending = ''
  let used = 0
  let isCut = false

  for (const hunk of hunks) {
    const room = Math.min(MAX_SOURCE_CHARS, budget - used)
    if (room < 200) {
      isCut = true
      break
    }

    const one = hunkText(hunk, room)
    isCut ||= one.isCut

    if (pending.length + one.text.length + 1 > MAX_SOURCE_CHARS) {
      sources.push(pending)
      pending = ''
    }

    pending = pending === '' ? one.text : `${pending}\n${one.text}`
    used += one.text.length + 1
  }

  if (pending !== '') sources.push(pending)

  return { sources, isCut, used }
}

/** Counts added and removed lines of hunks. */
export function countOf(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line[0] === '+') added += 1
      else if (line[0] === '-') removed += 1
    }
  }
  return { added, removed }
}

/** A diff that adds every line of `content`, for a new or untracked file. */
export function addedFileHunks(content: string): Hunk[] {
  const lines = clean(content).split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return []
  return [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map(line => `+${line}`) }]
}

/** A rough diff of an Edit's old and new strings, when the tool gave no patch. */
export function replaceHunks(oldText: string, newText: string): Hunk[] {
  const before = clean(oldText).split('\n')
  const after = clean(newText).split('\n')
  return [
    {
      oldStart: 1,
      oldLines: before.length,
      newStart: 1,
      newLines: after.length,
      lines: [...before.map(line => `-${line}`), ...after.map(line => `+${line}`)],
    },
  ]
}

/** The unified text of hunks, capped, for keeping an edit's patch. */
export function patchOf(hunks: readonly Hunk[], cap: number): string {
  const { sources } = codeSourcesOf(hunks, cap)
  return sources.join('\n')
}

/** Splits a multi-file patch (`git show`) into one patch per file. */
export function filePatchesOf(text: string): FilePatch[] {
  const files: FilePatch[] = []
  let lines: string[] = []
  let path = ''
  let oldPath: string | undefined
  let isBinary = false

  const flush = () => {
    if (path !== '') files.push({ path, ...(oldPath && oldPath !== path ? { oldPath } : {}), text: lines.join('\n'), isBinary })
    lines = []
    path = ''
    oldPath = undefined
    isBinary = false
  }

  for (const raw of text.split('\n')) {
    const line = clean(raw)
    if (line.startsWith('diff --git ')) {
      flush()
      const match = /^diff --git a\/(.*) b\/(.*)$/.exec(line)
      path = match?.[2] ?? line.slice(11)
      oldPath = match?.[1]
      continue
    }
    if (line.startsWith('+++ b/')) path = line.slice(6)
    else if (line.startsWith('Binary files ')) isBinary = true
    lines.push(line)
  }

  flush()
  return files
}
