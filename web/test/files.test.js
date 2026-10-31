/**
 * A repository's files read without following a link (web/files.js), against
 * temp folders, as the mod runs it: `node web/files.js` with the request on
 * stdin, one JSON line back. A plain file's text and lines; a binary one, a
 * big one, one not there; a link at the end or on the way, a FIFO and a
 * place outside the folder refused (never read through, never waited on);
 * and a file flipped between itself and a link to a secret while it is read,
 * at the end of its path and in a folder on the way, never read through.
 */
'use strict'
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn, spawnSync, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const FILES_JS = path.join(__dirname, '..', 'files.js')
const { readFiles, partsOf } = require('../files.js')
const isWindows = process.platform === 'win32'
const temps = []
after(() => { for (const dir of temps) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} } })

function tempDir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apiarius-files-')))
  temps.push(dir)
  return dir
}

/** Runs web/files.js as the mod does (node, no shell, the request on stdin): what it printed, parsed. */
function run(request) {
  const ran = spawnSync(process.execPath, [FILES_JS], { input: typeof request === 'string' ? request : JSON.stringify(request), encoding: 'utf8', timeout: 10_000 })
  assert.equal(ran.status, 0, ran.stderr)
  const lines = ran.stdout.split('\n').filter(Boolean)
  assert.equal(lines.length, 1, ran.stdout)
  return JSON.parse(lines[0])
}

const SECRET = 'FAKE-PRIVATE-KEY-do-not-use'

test('a plain file comes back with its size, its lines and its text; one with a NUL byte as binary, one past `most` as big, one not there as none; text only up to `textMost`', () => {
  const root = tempDir()
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'one\ntwo\nthree')
  fs.writeFileSync(path.join(root, 'empty.txt'), '')
  fs.writeFileSync(path.join(root, 'b.bin'), Buffer.from([1, 0, 2]))
  fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(200))
  const said = run({ root, paths: ['src/a.txt', 'empty.txt', 'b.bin', 'big.txt', 'nope.txt', 'src/a.txt/x'], most: 100, textMost: 100 })
  assert.equal(said.ok, true)
  assert.deepEqual(said.files.map(one => [one.path, one.kind]), [['src/a.txt', 'file'], ['empty.txt', 'file'], ['b.bin', 'binary'], ['big.txt', 'big'], ['nope.txt', 'none'], ['src/a.txt/x', 'none']])
  assert.deepEqual({ size: said.files[0].size, lines: said.files[0].lines, text: said.files[0].text }, { size: 13, lines: 3, text: 'one\ntwo\nthree' })
  assert.deepEqual({ lines: said.files[1].lines, text: said.files[1].text }, { lines: 0, text: '' })
  assert.equal(said.files[2].text, undefined)
  // lines alone where no text is asked for
  const counted = run({ root, paths: ['src/a.txt'], most: 100, textMost: 0 })
  assert.deepEqual(counted.files[0], { path: 'src/a.txt', kind: 'file', size: 13, mtimeMs: counted.files[0].mtimeMs, lines: 3 })
})

test('a link is never read through: one at the end of the path, one on the way, one for the folder`s own place; a FIFO is refused at once, never waited on; a place outside the folder is not one', { skip: isWindows }, () => {
  const root = tempDir()
  const outside = tempDir()
  fs.writeFileSync(path.join(outside, 'id_rsa'), SECRET)
  fs.mkdirSync(path.join(outside, 'dir'))
  fs.writeFileSync(path.join(outside, 'dir', 'notes.txt'), SECRET)
  fs.symlinkSync(path.join(outside, 'id_rsa'), path.join(root, 'key'))
  fs.symlinkSync(path.join(outside, 'dir'), path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, 'plain.txt'), 'mine\n')
  execFileSync('mkfifo', [path.join(root, 'pipe')])
  const started = Date.now()
  const said = run({ root, paths: ['key', 'sub/notes.txt', 'pipe', '../' + path.basename(outside) + '/id_rsa', '/etc/passwd', '', 'a/./b', 'plain.txt'], most: 1000, textMost: 1000 })
  assert.ok(Date.now() - started < 5000, 'the FIFO held the read')
  assert.deepEqual(said.files.map(one => [one.path, one.kind]), [
    ['key', 'refused'],
    ['sub/notes.txt', 'refused'],
    ['pipe', 'refused'],
    ['../' + path.basename(outside) + '/id_rsa', 'refused'],
    ['/etc/passwd', 'refused'],
    ['', 'refused'],
    ['a/./b', 'refused'],
    ['plain.txt', 'file'],
  ])
  assert.ok(!JSON.stringify(said).includes(SECRET))
  // the folder itself reached through a link is read where it really is: its own links are folded once, first
  const viaLink = path.join(tempDir(), 'repo-link')
  fs.symlinkSync(root, viaLink)
  assert.equal(run({ root: viaLink, paths: ['plain.txt'], most: 100, textMost: 100 }).files[0].text, 'mine\n')
  assert.deepEqual(partsOf('src/a.ts'), ['src', 'a.ts'])
  assert.equal(partsOf('src/../a.ts'), null)
})

test('an answer carries at most its room of text: the files past it come back counted, their text left for a later read; a request it cannot read says so', () => {
  const root = tempDir()
  const big = 'y'.repeat(1_000_000)
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), big)
  const said = readFiles({ root, paths: ['f0.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt'], most: 2_000_000, textMost: 2_000_000 })
  const withText = said.files.filter(one => typeof one.text === 'string').length
  assert.ok(withText >= 3 && withText < 5, `${withText} files carried text`)
  assert.ok(said.files.every(one => one.kind === 'file' && one.lines === 1))
  assert.deepEqual(run('not json'), { ok: false, why: 'bad request' })
  assert.deepEqual(run({ root: 'relative', paths: [], most: 1, textMost: 0 }), { ok: false, why: 'no folder' })
  assert.equal(run({ root, paths: Array(65).fill('f0.txt'), most: 1, textMost: 0 }).ok, false)
})

/** Flips `abs` for `ms` with a child process (true parallelism), reading it through the helper all the while: how many reads carried the secret. */
async function flipped(kind, ms) {
  const root = tempDir()
  const outside = tempDir()
  fs.writeFileSync(path.join(outside, 'secret'), SECRET)
  fs.mkdirSync(path.join(outside, 'evil'))
  fs.writeFileSync(path.join(outside, 'evil', 'notes.txt'), SECRET)
  const place = kind === 'folder' ? 'sub/notes.txt' : 'notes.txt'
  if (kind === 'folder') fs.mkdirSync(path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, place), 'just my notes\n')
  const target = kind === 'folder' ? path.join(root, 'sub') : path.join(root, 'notes.txt')
  const flipper = `
    const fs = require('fs'); const [target, kind, secret, evil] = process.argv.slice(1)
    for (;;) {
      if (kind === 'folder') {
        try { fs.renameSync(target, target + '.x') } catch {}
        try { fs.symlinkSync(evil, target) } catch {}
        try { fs.rmSync(target, { force: true }) } catch {}
        try { fs.renameSync(target + '.x', target) } catch {}
      } else {
        try { fs.rmSync(target, { force: true }); fs.symlinkSync(secret, target) } catch {}
        try { fs.rmSync(target, { force: true }); fs.writeFileSync(target, 'just my notes\\n') } catch {}
      }
    }`
  const child = spawn(process.execPath, ['-e', flipper, target, kind, path.join(outside, 'secret'), path.join(outside, 'evil')], { stdio: 'ignore' })
  let leaks = 0
  let reads = 0
  let plain = 0
  const until = Date.now() + ms
  try {
    while (Date.now() < until) {
      const said = readFiles({ root, paths: [place], most: 1000, textMost: 1000 })
      reads += 1
      const text = said.files?.[0]?.text
      if (typeof text === 'string' && text.includes(SECRET)) leaks += 1
      if (text === 'just my notes\n') plain += 1
      await new Promise(resolve => setImmediate(resolve))
    }
  } finally {
    child.kill('SIGKILL')
  }
  return { leaks, reads, plain }
}

test('a file flipped between itself and a link to a secret while it is read, at the end of its path or in a folder on the way, is never read through', { skip: isWindows }, async () => {
  for (const kind of ['final', 'folder']) {
    const { leaks, reads, plain } = await flipped(kind, 1500)
    assert.ok(reads > 100, `${kind}: only ${reads} reads`)
    assert.equal(leaks, 0, `${kind}: ${leaks} of ${reads} reads carried the secret (${plain} read the file itself)`)
  }
})
