/**
 * Apiarius's home on disk, kept private: the mod runs this with node (no
 * shell) for what the engine's own files cannot do, since `$.fs.write` makes
 * folders 0755 and files 0644 and removes nothing.
 *
 *   node web/home.js '<request as JSON>'
 *
 * The home is `APIARIUS_HOME`, else `apiarius` under Claude Code's
 * configuration folder. Each session's state folder is `<home>/web/<id>`
 * (its state, patches, git's diffs, messages, agent files, Org's Timeline
 * and the inbox other decks write into); the debug dump is `<home>/debug/`.
 * Every request names the home, never a path to act on: a session by its id,
 * a file by its place under the home (`FILE`).
 *
 * - `prepare` {home, id, files, registry}: the folders made 0700 (`<home>`
 *   when this made it or it is Apiarius's own, `<home>/web`, `<home>/web/<id>`
 *   and its folders, `<home>/sessions` and `<home>/debug` where they are),
 *   its `owner.json` (the session's process, the parent of this one), then
 *   each file in `files` made 0600 before the mod writes it: the engine's
 *   write keeps an existing file's mode. A debug file only while `<home>/debug`
 *   is. With `registry` (its folder) that folder is made 0700 and this
 *   session's file in it 0600, every other session's file in it 0600 too,
 *   before the registry writer's first write (whichever runs first).
 * - `remove` {home, ids}: those sessions' folders gone, whole.
 * - `clear` {home, id}: what a folder holds of the conversation gone (all but
 *   its inbox and owner.json), after a /clear.
 * - `sweep` {home, keep}: the folders of sessions that are gone
 *   (`orphanOf`, by each folder's own owner.json), but `keep`'s own.
 *
 * It never follows a symbolic link to delete or chmod: only a real folder
 * that is a direct child of `<home>/web` and named as a session
 * id is ever removed, as `lstat` sees it, and a removal deletes the links in
 * it, never what they point to. It prints one line, `{"ok":true,...}` or
 * `{"ok":false,"why":...}`, and exits 0 either way.
 */
'use strict'
const fs = require('fs')
const path = require('path')

const SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/
/** A file the mod writes, by its place under the home: a session's state and lazy files, or a debug dump. */
const FILE = /^(?:web\/[A-Za-z0-9_-]{1,100}\/(?:state\.json|timeline\.json|(?:patches|gitdiffs)\/[A-Za-z0-9_-]{1,128}\.diff|messages\/[A-Za-z0-9_-]{1,128}\.md|agents\/[A-Za-z0-9_-]{1,128}\.json)|debug\/[A-Za-z0-9_-]{1,100}\.json)$/
/** The folders of a session's state folder: its lazy files and its inbox. */
const SUBDIRS = ['patches', 'messages', 'agents', 'gitdiffs', 'inbox']
/** What a /clear removes from a state folder, everything of the conversation: these files, and what these folders hold (the folders stay, 0700). */
const CONTENT_FILES = ['state.json', 'timeline.json']
const CONTENT_DIRS = ['patches', 'messages', 'agents', 'gitdiffs']
/** A folder with no live owner is let be this long: a viewer's write may have just made it. */
const NEW_MS = 2 * 60_000
/** A folder whose owner process runs but nothing in it has been touched for this long goes anyway: the id a dead session's `owner.json` named may have been given to a long-lived process of someone else's (a planted pid like 1 would otherwise keep a dead folder forever). */
const MAX_KEEP_MS = 3 * 24 * 60 * 60_000
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)$/i // Windows device names: never a file name
const isWindows = process.platform === 'win32'
const UID = typeof process.getuid === 'function' ? process.getuid() : null
const NOFOLLOW = fs.constants.O_NOFOLLOW || 0
const NONBLOCK = fs.constants.O_NONBLOCK || 0 // a FIFO planted where a file is read never holds the open

const lstatOf = p => { try { return fs.lstatSync(p) } catch { return null } }
/** Whether `stat` is a real folder (no link) this user owns. */
const isOwnDir = stat => stat !== null && stat.isDirectory() && !stat.isSymbolicLink() && (UID === null || stat.uid === UID)
const isSessionName = name => SESSION_ID.test(name) && !DEVICE.test(name)

/** Makes `p` a real folder this user owns, 0700: made when missing, refused when it is a link, a file or another user's. */
function privateDir(p) {
  let stat = lstatOf(p)
  if (stat === null) {
    fs.mkdirSync(p, { mode: 0o700 })
    stat = lstatOf(p)
  }
  if (!isOwnDir(stat)) throw new Error(`${p} is not a folder of this user's`)
  if (!isWindows && (stat.mode & 0o777) !== 0o700) fs.chmodSync(p, 0o700)
}

/** Creates `p` empty, 0600, unless it is there already as this user's file (then made 0600); a link there is removed first, never followed. */
function privateFile(p) {
  const stat = lstatOf(p)
  if (stat !== null && stat.isSymbolicLink()) fs.unlinkSync(p)
  else if (stat !== null) {
    if (!stat.isFile() || (UID !== null && stat.uid !== UID)) throw new Error(`${p} is not a file of this user's`)
    if (!isWindows && (stat.mode & 0o777) !== 0o600) fs.chmodSync(p, 0o600)
    return
  }
  fs.closeSync(fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600))
}

/** Writes `text` to `p` (0600, a link there removed first, never followed; a FIFO there never holds the open, and nothing but a regular file is emptied or written). */
function writePrivate(p, text) {
  privateFile(p)
  // emptied once it is known to be a file, not by O_TRUNC: Windows refuses O_TRUNC without O_CREAT (EINVAL)
  const fd = fs.openSync(p, fs.constants.O_WRONLY | NOFOLLOW | NONBLOCK)
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error(`${p} is not a file of this user's`)
    fs.ftruncateSync(fd, 0)
    fs.writeSync(fd, text)
  } finally {
    fs.closeSync(fd)
  }
}

/** The home as given, absolute; null for none. */
function homeOf(home) {
  return typeof home === 'string' && home.trim() !== '' && path.isAbsolute(home.trim()) ? path.resolve(home.trim()) : null
}

/** `<home>/web`, a real folder this user owns, once every link above it is followed; null when it is not there or not that. */
function webRootOf(home) {
  let real
  try { real = fs.realpathSync(home) } catch { return null }
  const root = path.join(real, 'web')
  return isOwnDir(lstatOf(root)) ? root : null
}

/**
 * The registry folder made private (0700) and this session's file in it made
 * 0600, before the registry writer's first write of it (whichever runs
 * first: the engine's own write makes a new folder 0755 and a new file 0644,
 * and keeps an existing file's mode, so this both pre-creates and fixes).
 * Every other session's file in it is made 0600 too (files an earlier build
 * left looser). `dir` is the registry folder (`APIARIUS_SESSIONS`, else
 * `<home>/sessions`); a folder that is a link or another user's is refused.
 */
function secureRegistry(dir, id) {
  if (dir === null) return
  privateDir(dir)
  if (isSessionName(id)) privateFile(path.join(dir, `${id}.json`))
  let names = []
  try { names = fs.readdirSync(dir) } catch { return }
  for (const name of names) {
    if (!name.endsWith('.json') || !isSessionName(name.slice(0, -'.json'.length))) continue
    const p = path.join(dir, name)
    const stat = lstatOf(p)
    if (stat !== null && stat.isFile() && !stat.isSymbolicLink() && (UID === null || stat.uid === UID) && !isWindows && (stat.mode & 0o777) !== 0o600) fs.chmodSync(p, 0o600)
  }
}

function prepare({ home: given, id, files = [], isOwnHome = false, registry }) {
  const home = homeOf(given)
  if (home === null) return { ok: false, why: 'no home' }
  if (typeof id !== 'string' || !isSessionName(id)) return { ok: false, why: 'bad session id' }
  // its own folder's files alone, and the debug dump's
  const isOwn = file => typeof file === 'string' && FILE.test(file) && (file.startsWith('debug/') || file.split('/')[1] === id)
  if (!Array.isArray(files) || !files.every(isOwn)) return { ok: false, why: 'bad file' }
  const wasThere = lstatOf(home) !== null
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  const real = fs.realpathSync(home)
  // the home itself: made private when this made it, or it is Apiarius's own; a folder the person named stays as they keep it
  if (!wasThere || isOwnHome) privateDir(real)
  const root = path.join(real, 'web')
  privateDir(root)
  const dir = path.join(root, id)
  privateDir(dir)
  for (const sub of SUBDIRS) privateDir(path.join(dir, sub))
  for (const other of ['sessions', 'debug']) if (isOwnDir(lstatOf(path.join(real, other)))) privateDir(path.join(real, other))
  writePrivate(path.join(dir, 'owner.json'), `${JSON.stringify({ pid: process.ppid })}\n`)
  for (const file of files) {
    const parts = file.split('/')
    if (parts[0] === 'debug' && !isOwnDir(lstatOf(path.join(real, 'debug')))) continue // a dump only while its folder is there
    privateFile(path.join(real, ...parts))
  }
  // the registry folder and this session's file in it made private, however the race with the registry writer goes
  if (typeof registry === 'string' && registry.trim() !== '' && path.isAbsolute(registry.trim())) secureRegistry(path.resolve(registry.trim()), id)
  return { ok: true }
}

/** Removes the folder `<root>/<name>`, whole, when it is a real folder named as a session id; its links go, never what they point to. */
function removeChild(root, name) {
  if (!isSessionName(name)) return false
  const p = path.join(root, name)
  if (!isOwnDir(lstatOf(p))) return false
  fs.rmSync(p, { recursive: true, force: true })
  return true
}

function remove({ home: given, ids }) {
  const home = homeOf(given)
  if (home === null || !Array.isArray(ids)) return { ok: false, why: 'bad request' }
  const root = webRootOf(home)
  if (root === null) return { ok: true, removed: [] }
  return { ok: true, removed: ids.filter(id => typeof id === 'string' && removeChild(root, id)) }
}

function clear({ home: given, id }) {
  const home = homeOf(given)
  if (home === null || typeof id !== 'string' || !isSessionName(id)) return { ok: false, why: 'bad request' }
  const root = webRootOf(home)
  const dir = root === null ? null : path.join(root, id)
  if (dir === null || !isOwnDir(lstatOf(dir))) return { ok: true }
  // rm never follows a link: one in the folder goes, never what it points to
  for (const name of CONTENT_FILES) fs.rmSync(path.join(dir, name), { force: true })
  for (const name of CONTENT_DIRS) {
    const sub = path.join(dir, name)
    if (!isOwnDir(lstatOf(sub))) { fs.rmSync(sub, { recursive: true, force: true }); continue }
    for (const one of fs.readdirSync(sub)) fs.rmSync(path.join(sub, one), { recursive: true, force: true })
  }
  return { ok: true }
}

/** Whether process `pid` runs (EPERM: it does, as another user's). */
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' }
}

/** A JSON file's value, read without following a link and only as a regular file (it opens without blocking, so a FIFO there never holds it, and is read from what opened); null for anything else. */
function jsonOf(p) {
  const stat = lstatOf(p)
  if (stat === null || !stat.isFile() || stat.size > 64 * 1024) return null
  let fd
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | NOFOLLOW | NONBLOCK)
  } catch {
    return null
  }
  try {
    const opened = fs.fstatSync(fd)
    if (!opened.isFile() || opened.size > 64 * 1024) return null
    return JSON.parse(fs.readFileSync(fd, 'utf8'))
  } catch {
    return null
  } finally {
    fs.closeSync(fd)
  }
}

/** When something in session `name`'s folder was last touched: the newest of the folder's own time and its state and owner files' (a sharing session rewrites `state.json` often, so its folder is never judged stale). */
function lastTouchMs(dir) {
  let newest = 0
  for (const name of ['', 'state.json', 'owner.json']) {
    const stat = lstatOf(name === '' ? dir : path.join(dir, name))
    if (stat !== null) newest = Math.max(newest, stat.mtimeMs)
  }
  return newest
}

/**
 * Whether session `name`'s folder is an orphan at `now`, judged by its own
 * `owner.json` alone (never by a registry file, which carries no seal here
 * and a forger could write): its owner process is gone, so a crash left it;
 * or its owner process runs but nothing in it has been touched for
 * `MAX_KEEP_MS` (the id its owner names may since have gone to a long-lived
 * process of someone else's); or no owner is named and the folder is past
 * `NEW_MS` (a viewer's inbox write may have just made it). A folder whose
 * owner process runs and that was touched lately is a live session's, and is
 * never removed.
 */
function orphanOf(dir, name, now) {
  const folder = lstatOf(dir)
  if (folder === null) return false
  const owner = jsonOf(path.join(dir, 'owner.json'))
  if (owner && Number.isInteger(owner.pid) && owner.pid > 0) {
    if (!isAlive(owner.pid)) return true
    return now - lastTouchMs(dir) > MAX_KEEP_MS
  }
  return now - folder.mtimeMs > NEW_MS
}

function sweep({ home: given, keep = '' }) {
  const home = homeOf(given)
  if (home === null) return { ok: false, why: 'no home' }
  const now = Date.now()
  const removed = []
  const root = webRootOf(home)
  if (root !== null) {
    for (const one of fs.readdirSync(root, { withFileTypes: true })) {
      if (!one.isDirectory() || one.name === keep || !isSessionName(one.name)) continue
      if (orphanOf(path.join(root, one.name), one.name, now) && removeChild(root, one.name)) removed.push(one.name)
    }
  }
  return { ok: true, removed }
}

const OPS = { prepare, remove, clear, sweep }

/** Answers one request: what the op said, or why it failed. */
function run(request) {
  const op = request !== null && typeof request === 'object' ? OPS[request.op] : undefined
  if (!op || !Object.prototype.hasOwnProperty.call(OPS, request.op)) return { ok: false, why: 'unknown op' }
  try { return op(request) } catch (err) { return { ok: false, why: String(err && err.message ? err.message : err) } }
}

module.exports = { run, orphanOf, FILE, SESSION_ID }

if (require.main === module) {
  let request = null
  try { request = JSON.parse(process.argv[2] ?? '') } catch {}
  process.stdout.write(`${JSON.stringify(run(request))}\n`)
}
