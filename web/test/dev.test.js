/**
 * The dev deck (web/dev.js) end to end: a real process serving a sample, read
 * over HTTP as the page reads it. Its temp folder goes in the test's own.
 */
'use strict'
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DEV = path.join(__dirname, '..', 'dev.js')
const FIXTURES = path.join(__dirname, '..', 'fixtures')
const TOKEN = 'apiarius-dev-token'
const temps = []
const children = new Set()

after(() => {
  for (const child of children) child.kill()
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiarius-devtest-'))
  temps.push(dir)
  return dir
}

/** Runs dev.js with `args`, its temp folder under `tmp`; resolves with its port once it printed its link, or with its exit code and what it said on stderr. */
function run(args, tmp) {
  const child = spawn(process.execPath, [DEV, ...args], { env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  children.add(child)
  let out = ''
  let err = ''
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dev.js printed no link within 8 s: ${out}${err}`)), 8000)
    child.stdout.setEncoding('utf8').on('data', chunk => {
      out += chunk
      const link = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\S+)/.exec(out)
      if (link) { clearTimeout(timer); resolve({ child, port: Number(link[1]), token: link[2] }) }
    })
    child.stderr.setEncoding('utf8').on('data', chunk => { err += chunk })
    child.on('exit', code => { children.delete(child); clearTimeout(timer); resolve({ code, stderr: err }) })
  })
}

function get(port, target) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, headers: { 'X-Deck-Token': TOKEN } }, res => {
      let text = ''
      res.setEncoding('utf8').on('data', chunk => { text += chunk }).on('end', () => resolve({ status: res.statusCode, body: text }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** A sample of our own in a folder laid out as web/fixtures is (no sessions sample): web/fixtures' state with its goal's headline changed, and its lazy files. */
function ownSample(headline) {
  const dir = path.join(tempDir(), 'sample')
  fs.cpSync(path.join(FIXTURES, 'v2'), path.join(dir, 'v2'), { recursive: true })
  const state = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'state.v2.json'), 'utf8'))
  state.header.goal = { ...state.header.goal, headline }
  fs.writeFileSync(path.join(dir, 'state.v2.json'), JSON.stringify(state))
  return dir
}

test('dev.js --fixtures <dir> serves the sample in that folder, its lazy files with it, and no other sessions when it has no sessions sample', async () => {
  const sample = ownSample('Served from another folder')
  const dev = await run(['--static', '--fixtures', sample], tempDir())
  assert.ok(dev.port, `dev.js exited ${dev.code}: ${dev.stderr}`)
  assert.equal(dev.token, TOKEN)
  const state = JSON.parse((await get(dev.port, '/state')).body)
  assert.equal(state.v2.header.goal.headline, 'Served from another folder')
  assert.equal(state.v2.sessions, undefined)
  const builder = await get(dev.port, '/agent/b81c6f3e2a9d4c17')
  assert.equal(builder.status, 200)
  assert.equal(JSON.parse(builder.body).id, 'b81c6f3e2a9d4c17')
  dev.child.kill()
})

test('dev.js --fixtures stops at once on a folder with no sample, or with no folder named', async () => {
  const empty = tempDir()
  const none = await run(['--fixtures', empty], tempDir())
  assert.equal(none.code, 2)
  assert.match(none.stderr, /no state\.v2\.json in /)
  const bare = await run(['--fixtures'], tempDir())
  assert.equal(bare.code, 2)
  assert.match(bare.stderr, /usage: node web\/dev\.js \[--static\] \[--fixtures <dir>\]/)
})
