/**
 * Apiarius's home on disk (web/home.js) against temp folders, as the mod runs
 * it: `node web/home.js '<request>'`, one JSON line back. The session's
 * folder made private (0700, its files 0600 before the mod writes them),
 * removed at the end, emptied at a /clear, and the gone sessions' swept, never
 * following a link to delete or chmod.
 */
'use strict'
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const HOME_JS = path.join(__dirname, '..', 'home.js')
const isWindows = process.platform === 'win32'
const LINK = isWindows ? 'junction' : 'dir' // a junction needs no rights on Windows
const temps = []
after(() => { for (const dir of temps) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} } })

function tempDir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apiarius-home-')))
  temps.push(dir)
  return dir
}

/** Runs web/home.js as the mod does (node, no shell, the request as one argument): what it printed, parsed. */
function run(request) {
  const ran = spawnSync(process.execPath, [HOME_JS, typeof request === 'string' ? request : JSON.stringify(request)], { encoding: 'utf8' })
  assert.equal(ran.status, 0, ran.stderr)
  const lines = ran.stdout.split('\n').filter(Boolean)
  assert.equal(lines.length, 1, ran.stdout)
  return JSON.parse(lines[0])
}

const modeOf = p => fs.statSync(p).mode & 0o777
const exists = p => { try { fs.lstatSync(p); return true } catch { return false } }

/** A pid no process has any more: a child's, once it exited. */
async function deadPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise(resolve => child.on('exit', resolve))
  return child.pid
}

/** A session's folder as an earlier run left it: its files, and its owner (`pid`, or none). */
function leftFolder(root, id, { pid = null, files = { 'state.json': '{"v":1,"secret":true}' }, mtime = null } = {}) {
  const dir = path.join(root, id)
  fs.mkdirSync(path.join(dir, 'messages'), { recursive: true })
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
  if (pid !== null) fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid }))
  if (mtime !== null) fs.utimesSync(dir, mtime / 1000, mtime / 1000)
  return dir
}

test('prepare makes a new home, its web folder, the session`s folder and its folders 0700, its owner (this process) 0600, and each file named 0600 before the mod writes it', () => {
  const home = path.join(tempDir(), 'apiarius')
  const said = run({ op: 'prepare', home, id: 'sess-1', files: ['web/sess-1/state.json', 'web/sess-1/patches/toolu_1.diff', 'web/sess-1/agents/main.json'] })
  assert.deepEqual(said, { ok: true })
  const dir = path.join(home, 'web', 'sess-1')
  for (const sub of ['patches', 'messages', 'agents', 'gitdiffs', 'inbox']) assert.ok(fs.statSync(path.join(dir, sub)).isDirectory(), sub)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')), { pid: process.pid })
  for (const file of ['state.json', 'patches/toolu_1.diff', 'agents/main.json']) assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), '', file)
  if (isWindows) return
  for (const one of [home, path.join(home, 'web'), dir, path.join(dir, 'patches'), path.join(dir, 'inbox')]) assert.equal(modeOf(one), 0o700, one)
  for (const one of ['owner.json', 'state.json', 'patches/toolu_1.diff', 'agents/main.json']) assert.equal(modeOf(path.join(dir, one)), 0o600, one)
  // the engine's write keeps an existing file's mode: written over in place, the file stays 0600
  fs.writeFileSync(path.join(dir, 'state.json'), '{"v":1}')
  assert.equal(modeOf(path.join(dir, 'state.json')), 0o600)
})

test('prepare makes an existing file 0600 and loose folders 0700 (a viewer`s write made them 0755); a home the person named stays as they keep it, Apiarius`s own is made 0700', { skip: isWindows }, () => {
  const named = tempDir()
  fs.chmodSync(named, 0o755)
  const dir = path.join(named, 'web', 'sess-1')
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true, mode: 0o755 })
  fs.chmodSync(path.join(named, 'web'), 0o755)
  fs.writeFileSync(path.join(dir, 'state.json'), 'x', { mode: 0o644 })
  fs.mkdirSync(path.join(named, 'sessions'), { mode: 0o755 })
  fs.mkdirSync(path.join(named, 'debug'), { mode: 0o755 })
  assert.equal(run({ op: 'prepare', home: named, id: 'sess-1', files: ['web/sess-1/state.json'] }).ok, true)
  assert.equal(modeOf(named), 0o755)
  for (const one of [path.join(named, 'web'), dir, path.join(dir, 'inbox'), path.join(named, 'sessions'), path.join(named, 'debug')]) assert.equal(modeOf(one), 0o700, one)
  assert.equal(modeOf(path.join(dir, 'state.json')), 0o600)
  assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), 'x')
  assert.equal(run({ op: 'prepare', home: named, id: 'sess-1', files: [], isOwnHome: true }).ok, true)
  assert.equal(modeOf(named), 0o700)
})

test('prepare refuses what is not the session`s own: another session`s files, a path, a bad id or file name, a relative home', () => {
  const home = path.join(tempDir(), 'apiarius')
  for (const files of [['web/other-1/state.json'], ['../state.json'], ['web/sess-1/../x/state.json'], ['web/sess-1/notes.txt'], ['web/sess-1/patches/a.b.diff'], ['debug/../x.json'], ['web/sess-1/inbox/x.json'], [7]]) {
    assert.equal(run({ op: 'prepare', home, id: 'sess-1', files }).ok, false, JSON.stringify(files))
  }
  for (const id of ['..', 'a/b', '', 'a.b', 'x'.repeat(101), 'con']) assert.equal(run({ op: 'prepare', home, id, files: [] }).ok, false, id)
  assert.equal(run({ op: 'prepare', home: 'relative/home', id: 'sess-1', files: [] }).ok, false)
  assert.equal(exists(path.join(home, 'web', 'other-1')), false)
})

test('prepare never follows a link: a web folder or a session folder that is one is refused, its target untouched; a link where a file goes is removed, never written through', () => {
  const root = tempDir()
  const target = path.join(root, 'target')
  fs.mkdirSync(target)
  fs.writeFileSync(path.join(target, 'keep.txt'), 'mine')
  // <home>/web a link
  const linked = path.join(root, 'one')
  fs.mkdirSync(linked)
  fs.symlinkSync(target, path.join(linked, 'web'), LINK)
  assert.equal(run({ op: 'prepare', home: linked, id: 'sess-1', files: [] }).ok, false)
  assert.deepEqual(fs.readdirSync(target), ['keep.txt'])
  // <home>/web/<id> a link
  const two = path.join(root, 'two')
  fs.mkdirSync(path.join(two, 'web'), { recursive: true })
  fs.symlinkSync(target, path.join(two, 'web', 'sess-1'), LINK)
  assert.equal(run({ op: 'prepare', home: two, id: 'sess-1', files: [] }).ok, false)
  assert.deepEqual(fs.readdirSync(target), ['keep.txt'])
  if (isWindows) return // a file link needs rights there
  // a link where state.json goes: removed, and the file made in its place
  const three = path.join(root, 'three')
  assert.equal(run({ op: 'prepare', home: three, id: 'sess-1', files: [] }).ok, true)
  const victim = path.join(target, 'keep.txt')
  fs.symlinkSync(victim, path.join(three, 'web', 'sess-1', 'state.json'))
  assert.equal(run({ op: 'prepare', home: three, id: 'sess-1', files: ['web/sess-1/state.json'] }).ok, true)
  assert.equal(fs.lstatSync(path.join(three, 'web', 'sess-1', 'state.json')).isSymbolicLink(), false)
  assert.equal(fs.readFileSync(victim, 'utf8'), 'mine')
  assert.equal(modeOf(victim) === 0o600, false)
})

test('prepare makes a debug dump`s file only while the person`s debug folder is there', () => {
  const home = path.join(tempDir(), 'apiarius')
  assert.equal(run({ op: 'prepare', home, id: 'sess-1', files: ['debug/sess-1.json'] }).ok, true)
  assert.equal(exists(path.join(home, 'debug')), false)
  fs.mkdirSync(path.join(home, 'debug'))
  assert.equal(run({ op: 'prepare', home, id: 'sess-1', files: ['debug/sess-1.json'] }).ok, true)
  assert.equal(fs.readFileSync(path.join(home, 'debug', 'sess-1.json'), 'utf8'), '')
  if (!isWindows) assert.equal(modeOf(path.join(home, 'debug', 'sess-1.json')), 0o600)
})

test('remove deletes the session`s folder whole, never what a link in it points to; a name that is no session id, a link, or a web folder that is a link, is left alone', () => {
  const root = tempDir()
  const home = path.join(root, 'apiarius')
  assert.equal(run({ op: 'prepare', home, id: 'sess-1', files: ['web/sess-1/state.json'] }).ok, true)
  const outside = path.join(root, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'keep me')
  fs.symlinkSync(outside, path.join(home, 'web', 'sess-1', 'messages', 'evil'), LINK)
  fs.symlinkSync(outside, path.join(home, 'web', 'link-1'), LINK)
  fs.writeFileSync(path.join(home, 'secret.json'), '{}')
  const said = run({ op: 'remove', home, ids: ['sess-1', 'link-1', '..', '../secret.json', 'nobody-1', 7] })
  assert.deepEqual(said, { ok: true, removed: ['sess-1'] })
  assert.equal(exists(path.join(home, 'web', 'sess-1')), false)
  assert.equal(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'keep me')
  assert.equal(fs.lstatSync(path.join(home, 'web', 'link-1')).isSymbolicLink(), true)
  assert.ok(exists(path.join(home, 'secret.json')))
  // the whole web folder a link: nothing under its target goes
  const other = path.join(root, 'other')
  fs.mkdirSync(path.join(other))
  fs.mkdirSync(path.join(outside, 'sess-2'))
  fs.symlinkSync(outside, path.join(other, 'web'), LINK)
  assert.deepEqual(run({ op: 'remove', home: other, ids: ['sess-2'] }), { ok: true, removed: [] })
  assert.ok(exists(path.join(outside, 'sess-2')))
})

test('clear (a /clear) empties what the folder holds of the conversation, its folders, inbox and owner kept', () => {
  const home = path.join(tempDir(), 'apiarius')
  assert.equal(run({ op: 'prepare', home, id: 'sess-1', files: ['web/sess-1/state.json', 'web/sess-1/timeline.json', 'web/sess-1/messages/m1.md', 'web/sess-1/patches/p1.diff'] }).ok, true)
  const dir = path.join(home, 'web', 'sess-1')
  fs.writeFileSync(path.join(dir, 'inbox', 'viewer-1.json'), '{}')
  assert.deepEqual(run({ op: 'clear', home, id: 'sess-1' }), { ok: true })
  assert.deepEqual(fs.readdirSync(dir).sort(), ['agents', 'gitdiffs', 'inbox', 'messages', 'owner.json', 'patches'])
  for (const sub of ['messages', 'patches']) assert.deepEqual(fs.readdirSync(path.join(dir, sub)), [], sub)
  assert.deepEqual(fs.readdirSync(path.join(dir, 'inbox')), ['viewer-1.json'])
  if (!isWindows) assert.equal(modeOf(path.join(dir, 'messages')), 0o700)
})

test('sweep removes the folders of sessions that are gone, by their owner`s process or, with none, the registry; keeps a live one`s, a new one`s and its own; never a link or a file', async () => {
  const root = tempDir()
  const home = path.join(root, 'apiarius')
  const web = path.join(home, 'web')
  const registry = path.join(home, 'sessions')
  fs.mkdirSync(registry, { recursive: true })
  fs.mkdirSync(web, { recursive: true })
  const dead = await deadPid()
  const old = Date.now() - 10 * 60_000
  const entry = (id, extra) => fs.writeFileSync(path.join(registry, `${id}.json`), JSON.stringify({ v: 1, id, heartbeatAt: Date.now(), pid: dead, ...extra }))
  leftFolder(web, 'crashed-1', { pid: dead })
  leftFolder(web, 'alive-1', { pid: process.pid })
  entry('alive-1', { endedAt: Date.now() }) // a registry file says it ended, but its process runs: kept, whatever a registry file says
  leftFolder(web, 'mine-1', { pid: dead })
  leftFolder(web, 'ended-1', { mtime: old })
  entry('ended-1', { endedAt: Date.now() })
  leftFolder(web, 'listed-1', { mtime: old })
  entry('listed-1', {})
  leftFolder(web, 'silent-1', { mtime: old })
  entry('silent-1', { heartbeatAt: Date.now() - 60 * 60_000 })
  leftFolder(web, 'fresh-1') // a viewer's inbox write just made it: let be a while
  leftFolder(web, 'orphan-1', { mtime: old })
  const outside = path.join(root, 'outside')
  fs.mkdirSync(path.join(outside, 'inner'), { recursive: true })
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'keep me')
  fs.symlinkSync(outside, path.join(web, 'link-1'), LINK)
  fs.writeFileSync(path.join(web, 'file-1'), 'a file')
  // an earlier version's folders under the mod: this session's own goes, a dead one's goes, a live one's stays
  const legacy = path.join(root, 'mod', '.web')
  leftFolder(legacy, 'mine-1', { mtime: old })
  leftFolder(legacy, 'gone-2', { mtime: old })
  leftFolder(legacy, 'live-2', { mtime: old })
  entry('live-2', {})

  const said = run({ op: 'sweep', home, registry, keep: 'mine-1', legacy })
  assert.equal(said.ok, true)
  assert.deepEqual(said.removed.sort(), ['crashed-1', 'ended-1', 'legacy:gone-2', 'legacy:mine-1', 'orphan-1', 'silent-1'])
  assert.deepEqual(fs.readdirSync(web).sort(), ['alive-1', 'file-1', 'fresh-1', 'link-1', 'listed-1', 'mine-1'])
  assert.deepEqual(fs.readdirSync(legacy), ['live-2'])
  assert.deepEqual(fs.readdirSync(outside).sort(), ['inner', 'precious.txt'])
})

test('the command line: one JSON line back, a bad request or an unknown op refused', () => {
  assert.equal(run('not json').ok, false)
  assert.equal(run({ op: 'delete', home: tempDir() }).ok, false)
  assert.equal(run({ op: '__proto__', home: tempDir() }).ok, false)
  assert.equal(run({ op: 'toString', home: tempDir() }).ok, false)
  assert.equal(run({ op: 'sweep', home: '' }).ok, false)
  assert.deepEqual(run({ op: 'remove', home: tempDir(), ids: ['nobody-1'] }), { ok: true, removed: [] })
})
