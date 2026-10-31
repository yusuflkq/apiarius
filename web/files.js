/**
 * Reads files inside a folder without following a symbolic link anywhere on
 * the way: a repository's untracked files (their text for Changes, their
 * line counts) and its attribute files. The engine's own `$.fs.read`
 * follows links, so a file swapped for a link between the deck's look and
 * its read would hand it the link's target; the mod runs this with node (no
 * shell) instead, once for a batch of files.
 *
 *   node web/files.js   (the request as JSON on stdin)
 *
 * The request is `{ root, paths, most, textMost }`: the folder (absolute;
 * its own links folded once, here), the files by their place under it
 * (`src/a.ts`: never absolute, empty, `.` or `..`), the most bytes a file
 * may hold to be read at all, and the most whose text comes back (0: none,
 * its line count alone).
 *
 * Each file is opened by the folder's real path joined with its place, once:
 * - macOS: with O_NOFOLLOW_ANY, so a link in any part of the path fails the
 *   open itself (ELOOP);
 * - Linux: with O_NOFOLLOW (the last part), then the kernel's own name for
 *   what opened (`/proc/self/fd/<fd>`) must be exactly that path, so a link
 *   in a folder on the way is caught too;
 * - everywhere: with O_NONBLOCK, so a FIFO never holds the open; what opened
 *   must be a regular file (fstat), the very one an lstat of the path saw
 *   just before (its device and file id), still at that path once every link
 *   is followed; and the bytes come from that descriptor, never the path.
 * - Windows has no open that refuses a link on the way, and node no openat:
 *   there those looks are all there is. What they leave is a folder on the
 *   way swapped for a junction and back again around the open itself, within
 *   the instants between them.
 *
 * It prints one line, `{"ok":true,"files":[…]}` (in the request's order, each
 * `{ path, kind }`: `file` with its `size`, `mtimeMs`, `lines` and, when it
 * fits `textMost` and the answer's room, its `text`; `binary`, a NUL byte in
 * it; `big`, past `most`; `none`, not there; `refused`, a link on the way, no
 * regular file, or unreadable, with `why`) or `{"ok":false,"why":…}`, and
 * exits 0 either way.
 */
'use strict'
const fs = require('fs')
const path = require('path')

/** The most files one request reads. */
const MOST_PATHS = 64
/** The most bytes of text one answer carries, as JSON: `$.process.run` keeps 4 MiB of a child's output. */
const ROOM = 3_500_000
/** The most bytes any one file may hold to be read (a read of the engine's own stops at 4 MiB too). */
const MOST_BYTES = 4_000_000
const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'
const isWindows = process.platform === 'win32'
/** macOS's O_NOFOLLOW_ANY (sys/fcntl.h, macOS 11 on), which node does not name. */
const NOFOLLOW_ANY = isMac ? (fs.constants.O_NOFOLLOW_ANY || 0x20000000) : 0
// macOS refuses O_NOFOLLOW beside O_NOFOLLOW_ANY (EINVAL): the one covers the other
const FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0) | (NOFOLLOW_ANY || fs.constants.O_NOFOLLOW || 0)
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i // Windows device names: never a file name
const hasProc = isLinux && (() => { try { return fs.statSync('/proc/self/fd').isDirectory() } catch { return false } })()

/** A place under the folder as its parts, each a name; null for anything else (absolute, empty, `.`, `..`, a NUL, a drive or stream on Windows). */
function partsOf(place) {
  if (typeof place !== 'string' || place === '' || place.length > 4096 || place.includes('\0') || path.isAbsolute(place)) return null
  const parts = place.split(isWindows ? /[\\/]/ : '/')
  const isName = part => part !== '' && part !== '.' && part !== '..' && !(isWindows && (part.includes(':') || DEVICE.test(part)))
  return parts.every(isName) ? parts : null
}

/** Whether two spellings of one absolute path are the same (Windows: in any case). */
const samePath = (a, b) => (isWindows ? a.toLowerCase() === b.toLowerCase() : a === b)

/**
 * Opens `target` (an absolute path with no link in it, as built) for reading,
 * without following a link anywhere on the way: its descriptor and what
 * fstat says of it; else `none` (not there) or why it was refused.
 */
function openNoLink(target) {
  let before
  try {
    before = fs.lstatSync(target, { bigint: true })
  } catch (err) {
    return err.code === 'ENOENT' || err.code === 'ENOTDIR' ? { kind: 'none' } : { kind: 'refused', why: err.code || 'unreadable' }
  }
  if (before.isSymbolicLink()) return { kind: 'refused', why: 'a link' }
  if (!before.isFile()) return { kind: 'refused', why: 'not a regular file' }
  let fd
  try {
    fd = fs.openSync(target, FLAGS)
  } catch (err) {
    if (err.code === 'ELOOP' || err.code === 'EMLINK') return { kind: 'refused', why: 'a link on the way' }
    return err.code === 'ENOENT' || err.code === 'ENOTDIR' ? { kind: 'none' } : { kind: 'refused', why: err.code || 'unreadable' }
  }
  const refuse = why => {
    fs.closeSync(fd)
    return { kind: 'refused', why }
  }
  let stat
  try {
    stat = fs.fstatSync(fd, { bigint: true })
  } catch (err) {
    return refuse(err.code || 'unreadable')
  }
  if (!stat.isFile()) return refuse('not a regular file')
  // the very file the look saw, by its device and its id on it
  if (stat.dev !== before.dev || stat.ino !== before.ino) return refuse('changed while it was opened')
  // what opened, by the kernel's own name for it (Linux); elsewhere the path, every link followed, must still be itself
  try {
    if (hasProc) {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`) !== target) return refuse('a link on the way')
    } else if (!samePath(fs.realpathSync.native(target), target)) {
      return refuse('a link on the way')
    }
  } catch (err) {
    return refuse(err.code || 'unreadable')
  }
  return { kind: 'open', fd, size: Number(stat.size), mtimeMs: Number(stat.mtimeMs) }
}

/** Up to `most + 1` bytes from `fd`, from its start: one more than `most` says it is bigger. */
function readUpTo(fd, most) {
  const chunks = []
  let total = 0
  for (;;) {
    const want = Math.min(64 * 1024, most + 1 - total)
    if (want <= 0) break
    const chunk = Buffer.allocUnsafe(want)
    const got = fs.readSync(fd, chunk, 0, want, total)
    if (got === 0) break
    chunks.push(got === want ? chunk : chunk.subarray(0, got))
    total += got
  }
  return Buffer.concat(chunks, total)
}

/** The lines `bytes` holds, as the deck counts them: each newline one, and a last line without one. */
function linesOf(bytes) {
  let lines = 0
  for (let i = bytes.indexOf(10); i >= 0; i = bytes.indexOf(10, i + 1)) lines += 1
  return bytes.length > 0 && bytes[bytes.length - 1] !== 10 ? lines + 1 : lines
}

/** One file read, as its answer says it; `room` holds what the answer may still carry of text. */
function readOne(realRoot, place, most, textMost, room) {
  const parts = partsOf(place)
  if (parts === null) return { path: place, kind: 'refused', why: 'not a place in the folder' }
  const opened = openNoLink(path.join(realRoot, ...parts))
  if (opened.kind !== 'open') return { path: place, ...opened }
  const { fd, size, mtimeMs } = opened
  try {
    if (size > most) return { path: place, kind: 'big', size, mtimeMs }
    const bytes = readUpTo(fd, most)
    if (bytes.length > most) return { path: place, kind: 'big', size: bytes.length, mtimeMs }
    if (bytes.includes(0)) return { path: place, kind: 'binary', size: bytes.length, mtimeMs }
    const one = { path: place, kind: 'file', size: bytes.length, mtimeMs, lines: linesOf(bytes) }
    if (bytes.length <= textMost) {
      const text = bytes.toString('utf8')
      const cost = Buffer.byteLength(JSON.stringify(text))
      if (cost <= room.left) {
        room.left -= cost
        one.text = text
      }
    }
    return one
  } catch (err) {
    return { path: place, kind: 'refused', why: err.code || 'unreadable' }
  } finally {
    fs.closeSync(fd)
  }
}

/** Answers one request: each file's answer, in order, or why none could be read. */
function readFiles(request) {
  if (request === null || typeof request !== 'object') return { ok: false, why: 'bad request' }
  const { root, paths, most, textMost = 0 } = request
  if (typeof root !== 'string' || !path.isAbsolute(root)) return { ok: false, why: 'no folder' }
  if (!Array.isArray(paths) || paths.length > MOST_PATHS) return { ok: false, why: 'bad paths' }
  const isBytes = n => Number.isInteger(n) && n >= 0 && n <= MOST_BYTES
  if (!isBytes(most) || !isBytes(textMost)) return { ok: false, why: 'bad sizes' }
  let realRoot
  try {
    realRoot = fs.realpathSync.native(root)
  } catch (err) {
    return { ok: false, why: err.code || 'no folder' }
  }
  const room = { left: ROOM }
  return { ok: true, files: paths.map(place => readOne(realRoot, place, most, textMost, room)) }
}

module.exports = { readFiles, openNoLink, partsOf, linesOf }

if (require.main === module) {
  let text = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    if (text.length <= 1_000_000) text += chunk
  })
  process.stdin.on('end', () => {
    let request = null
    try { request = JSON.parse(text) } catch {}
    let answer
    try { answer = readFiles(request) } catch (err) { answer = { ok: false, why: String(err && err.message ? err.message : err) } }
    process.stdout.write(`${JSON.stringify(answer)}\n`)
  })
}
