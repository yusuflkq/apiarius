/**
 * The web server against a temp dir, end to end: `node --test tests/web/`.
 * Each test talks to a real server process over HTTP, as the page and the mod do.
 */
'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const WEB = path.join(__dirname, '..', '..', 'plugin', 'web')
const SERVER = path.join(WEB, 'server.js')
const crypto = require('node:crypto')
/** The secret the servers here start with: what their tickets are sealed with, never a credential itself. */
const SECRET = 'test-token-0123456789abcdef'

/** A ticket of `grade` for a server started with `secret`, as hooks/web.ts ticketOf makes one: `<p|f>-<nonce>-<seal>`, or `<p|f>-<nonce>-<until>-<seal>` with a deadline (`until`, seconds since the epoch). */
function ticketOf(grade, nonce = crypto.randomBytes(8).toString('hex'), secret = SECRET, until = 0) {
  const deadline = until > 0 ? Math.floor(until).toString(16).padStart(8, '0') : ''
  const seal = crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(`apiarius/ticket/1|${grade}|${nonce}${deadline ? `|${deadline}` : ''}`).digest('hex').slice(0, 32)
  return `${grade === 'full' ? 'f' : 'p'}-${nonce}-${deadline ? `${deadline}-` : ''}${seal}`
}

/** Each server's `full` handle (what most tests read and send with), by its port. */
const HANDLES = new Map()
/** The handle header for the server on `port`. */
const authOf = port => ({ 'X-Deck-Handle': HANDLES.get(port) ?? '' })
const EMPTY = '{"v":1,"empty":true}'
const STATE = { v: 1, now: 1, agents: [{ id: 'main', status: 'running' }] }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const children = new Set()
const temps = []

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-web-'))
  temps.push(dir)
  return dir
}

/** Runs `check` now and on every change until it returns something (or throws), failing after `ms`. */
function waitFor(subscribe, check, ms, what) {
  return new Promise((resolve, reject) => {
    let stop = () => {}
    const settle = (fn, value) => { clearTimeout(timer); stop(); fn(value) }
    const timer = setTimeout(() => settle(reject, new Error(`no ${what} within ${ms} ms`)), ms)
    const attempt = () => {
      try {
        const found = check()
        if (found !== undefined) settle(resolve, found)
      } catch (err) {
        settle(reject, err)
      }
    }
    stop = subscribe(attempt)
    attempt()
  })
}

/**
 * Starts a server; resolves once it printed its ready line. `lines` collects
 * what it prints after. `stdin`: 'pipe' kept open, 'closed' (a pipe ended at
 * once), 'ignore', or 'token' (the secret as its first line, then its end, as
 * the mod's $.process.spawn gives it with `input`; `input` says what else).
 */
function start({ dir, args = [], stdin = 'pipe', env = { APIARIUS_SECRET: SECRET }, input = `${SECRET}\n`, handle = true } = {}) {
  const argv = [SERVER, '--dir', dir, ...args]
  const child = spawn(process.execPath, argv, { env: { ...process.env, APIARIUS_SECRET: '', ...env }, stdio: [['closed', 'token'].includes(stdin) ? 'pipe' : stdin, 'pipe', 'pipe'], windowsHide: true })
  if (stdin === 'closed') child.stdin.end()
  if (stdin === 'token') child.stdin.end(input)
  children.add(child)
  const server = { child, lines: [], used: [], first: null, port: 0, stderr: '', exited: false, listeners: new Set() }
  const notify = () => { for (const fn of [...server.listeners]) fn() }
  server.on = fn => { server.listeners.add(fn); return () => server.listeners.delete(fn) }
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    let at
    while ((at = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      if (server.first === null) server.first = line
      // a ticket traded: its own list, so `lines` holds the commands alone
      else if (/^\{"used":/.test(line)) server.used.push(JSON.parse(line))
      else server.lines.push(line)
    }
    notify()
  })
  child.stderr.on('data', chunk => { server.stderr += chunk })
  child.on('exit', code => { server.exited = true; server.code = code; children.delete(child); notify() })
  return waitFor(server.on, () => {
    if (server.first !== null) { server.port = JSON.parse(server.first).ready; return server }
    if (server.exited) throw new Error(`the server exited with ${server.code}: ${server.stderr}`)
  }, 5000, 'ready line').then(async ready => {
    // as the page does at load: a full ticket traded for a handle, which the tests send
    if (handle) { ready.handle = (await trade(ready.port, ticketOf('full'))).handle; HANDLES.set(ready.port, ready.handle) }
    return ready
  })
}

/** POST /session, as the page trades its link's ticket: what the server answered, parsed, with its status. */
async function trade(port, ticket, headers = {}) {
  const res = await request(port, { method: 'POST', path: '/session', headers: { 'X-Deck-Ticket': ticket, Origin: `http://127.0.0.1:${port}`, ...headers } })
  let body = null
  try { body = JSON.parse(res.body) } catch {}
  return { status: res.status, ...(body || {}) }
}

const exitOf = (server, ms) => waitFor(server.on, () => (server.exited ? server.code : undefined), ms, 'exit')

function request(port, { method = 'GET', path: target = '/state', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

/** Opens /events; `next()` resolves with the next `event: state` payload. */
function events(port, headers = authOf(port)) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/events', headers }, res => {
      const stream = { res, got: [], read: 0, listeners: new Set(), close: () => req.destroy() }
      stream.on = fn => { stream.listeners.add(fn); return () => stream.listeners.delete(fn) }
      stream.next = (ms = 3000) => waitFor(stream.on, () => (stream.got.length > stream.read ? stream.got[stream.read++] : undefined), ms, 'state event')
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        buffer += chunk.replace(/\r/g, '')
        let at
        while ((at = buffer.indexOf('\n\n')) !== -1) {
          const lines = buffer.slice(0, at).split('\n')
          buffer = buffer.slice(at + 2)
          if (lines.includes('event: state')) stream.got.push(lines.filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n'))
        }
        for (const fn of [...stream.listeners]) fn()
      })
      resolve(stream)
    })
    req.on('error', reject)
  })
}

const post = (port, body, headers = {}) => request(port, {
  method: 'POST',
  path: '/cmd',
  headers: { 'Content-Type': 'application/json', ...authOf(port), Origin: `http://127.0.0.1:${port}`, ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

// ---- one server for most tests, over a dir with a state and a patch

let dir = ''
let main = null
const writeState = value => fs.writeFileSync(path.join(dir, 'state.json'), typeof value === 'string' ? value : JSON.stringify(value, null, 2))

const ANSWER = '**Done.** The limiter is in `src/middleware/rateLimit.ts`.\n\n- 100 requests a minute\n- 429 with Retry-After\n'
const GIT_DIFF = "@@ -1,2 +1,3 @@\n import express from 'express'\n+import { rateLimit } from './middleware/rateLimit'\n const app = express()\n"
const AGENT_FILE = `${JSON.stringify({ v: 2, id: 'b81c6f3e2a9d4c17', task: 'Write the limiter.', result: '', todos: [], activity: [{ id: 'toolu_01BldB2', at: 1, tool: 'Bash', target: 'Run the limiter tests', command: 'npm test -- rateLimit', ok: null, ms: null }], edits: ['toolu_01BldW1'] }, null, 2)}\n`

before(async () => {
  const root = tempDir()
  dir = path.join(root, 'session')
  fs.mkdirSync(path.join(dir, 'patches'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'messages'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'gitdiffs'), { recursive: true })
  fs.writeFileSync(path.join(root, 'secret.diff'), 'SECRET')
  fs.writeFileSync(path.join(root, 'secret.md'), 'SECRET')
  fs.writeFileSync(path.join(root, 'secret.json'), 'SECRET')
  fs.writeFileSync(path.join(dir, 'agents', 'b81c6f3e2a9d4c17.json'), AGENT_FILE)
  fs.writeFileSync(path.join(dir, 'agents', 'main.json'), '{"v":2,"id":"main","task":"","result":"","todos":[],"activity":[],"edits":[]}\n')
  fs.writeFileSync(path.join(dir, 'patches', 'toolu_01Abc-d_9.diff'), '@@ -1,1 +1,1 @@\n-old\n+new\n')
  fs.writeFileSync(path.join(dir, 'messages', '1791970900000-14-main-you.md'), ANSWER)
  fs.writeFileSync(path.join(dir, 'gitdiffs', '1kejm2g-1kfevo4-4g.diff'), GIT_DIFF)
  writeState(STATE)
  main = await start({ dir })
})

after(async () => {
  const running = [...children].filter(child => child.exitCode === null && child.signalCode === null)
  await Promise.all(running.map(child => new Promise(resolve => { child.once('exit', resolve); child.kill() })))
  for (const temp of temps) {
    try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 }) } catch {} // a leftover temp dir is harmless
  }
})

test('refuses to start without a secret, or with bad arguments', async () => {
  await assert.rejects(start({ dir: tempDir(), env: {}, stdin: 'closed' }), /exited with 2/)
  await assert.rejects(start({ dir: tempDir(), env: {}, stdin: 'ignore' }), /exited with 2/)
  await assert.rejects(start({ dir: tempDir(), env: {}, stdin: 'token', input: 'short\n' }), /exited with 2/)
  await assert.rejects(start({ dir: tempDir(), env: {}, stdin: 'token', input: 'has a space 0123456789\n' }), /exited with 2/)
  await assert.rejects(start({ dir: tempDir(), env: { APIARIUS_SECRET: 'short' } }), /exited with 2/)
  await assert.rejects(start({ dir: tempDir(), args: ['--parent', 'abc'] }), /exited with 2/)
  await assert.rejects(start({ dir: tempDir(), args: ['--port', '70000'] }), /exited with 2/)
  await assert.rejects(start({ dir: tempDir(), args: ['--verbose', '1'] }), /exited with 2/)
})

test('prints the ready line first, with the port it listens on', async () => {
  assert.match(main.first, /^\{"ready":\d+\}$/)
  assert.ok(main.port > 0)
  assert.equal((await request(main.port, { headers: authOf(main.port) })).status, 200)
})

test('takes the secret as the first line of stdin, as the mod gives it, and stays up once stdin ends; the secret itself opens nothing', async () => {
  const server = await start({ dir: tempDir(), env: {}, stdin: 'token' })
  await sleep(1500) // its stdin ended at once, after the secret: that says nothing of the parent
  assert.equal(server.exited, false)
  assert.equal((await request(server.port, { headers: authOf(server.port) })).status, 200)
  assert.equal((await request(server.port, { headers: { 'X-Deck-Handle': 'wrong-handle-0123456789' } })).status, 403)
  // the secret seals tickets: as a handle, a token of old or a ticket in a header it is refused
  for (const headers of [{ 'X-Deck-Handle': SECRET }, { 'X-Deck-Token': SECRET }, { 'X-Deck-Ticket': SECRET }]) assert.equal((await request(server.port, { headers })).status, 403, Object.keys(headers)[0])
  assert.equal((await head(server.port, `/events?t=${SECRET}`)).status, 403)
  // the secret is in no argument another process could read
  assert.ok(!server.child.spawnargs.join(' ').includes(SECRET))
  server.child.kill()
})

/** Every data route, with what it answers with a handle: the state, the stream, each lazy file, another session's, Org's Timeline. */
const DATA = [['/state', 200], ['/events', 200], ['/patch/toolu_01Abc-d_9', 200], ['/gitdiff/1kejm2g-1kfevo4-4g', 200], ['/message/1791970900000-14-main-you', 200], ['/agent/main', 200], ['/timeline', 404], ['/s/other-1/state', 404], ['/nope', 404]]
/** The page's scripts: app.js and every module of its own it imports (./page-script.js), then the two the mod imports too. */
const SCRIPTS = [...require('./page-script').modules(), 'avatars.mjs', 'timeline.mjs']
/** The page's own files: no data in them. */
const STATIC = ['/', '/app.css', ...SCRIPTS.map(file => `/${file}`), '/favicon.ico']

/** A GET that resolves on the answer's head, for /events too, which never ends. */
function head(port, target, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: target, headers }, res => { resolve({ status: res.statusCode, headers: res.headers }); req.destroy() })
    req.on('error', reject)
  })
}

test('the page`s own files need no handle; every data route refuses without one (403), and answers with the header', async () => {
  for (const target of STATIC) {
    const res = await head(main.port, target)
    assert.ok([200, 204].includes(res.status), `${target}: ${res.status}`)
  }
  for (const [target, status] of DATA) {
    assert.equal((await head(main.port, target)).status, 403, target)
    assert.equal((await head(main.port, target, { 'X-Deck-Handle': 'wrong-handle-0123456789' })).status, 403, target)
    assert.equal((await head(main.port, target, authOf(main.port))).status, status, target)
  }
  // not GET: refused without a handle too, whatever the path
  for (const method of ['PUT', 'DELETE', 'HEAD', 'OPTIONS']) assert.equal((await request(main.port, { method, path: '/state' })).status, 403, method)
  assert.equal((await request(main.port, { method: 'POST', path: '/' })).status, 403)
})

test('the h param stands for the header on /events alone (an EventSource sends none); on any other route it is refused', async () => {
  assert.equal((await head(main.port, `/events?h=${main.handle}`)).status, 200)
  assert.equal((await head(main.port, '/events?h=wrong-handle-0123456789')).status, 403)
  // a ticket opens nothing but its trade
  assert.equal((await head(main.port, `/events?t=${ticketOf('full')}`)).status, 403)
  for (const [target] of DATA.filter(([one]) => one !== '/events')) assert.equal((await head(main.port, `${target}?h=${encodeURIComponent(main.handle)}`)).status, 403, target)
})

test('no cookie: none is ever set, and one that carries a handle opens nothing', async () => {
  for (const target of [...STATIC, `/?t=${ticketOf('full')}`, `/state?h=${main.handle}`, `/events?h=${main.handle}`]) {
    assert.equal((await head(main.port, target, authOf(main.port))).headers['set-cookie'], undefined, target)
    assert.equal((await head(main.port, target)).headers['set-cookie'], undefined, target)
  }
  for (const cookie of [`deck_h_${main.port}=${main.handle}`, `deck_h=${main.handle}`, `h=${main.handle}`]) assert.equal((await head(main.port, '/state', { Cookie: cookie })).status, 403, cookie)
})

test('a ticket trades once for a handle of its grade (POST /session, from its own Origin), and the mod hears of it; used again, sealed with another secret, of another shape or from another origin, it is refused', async () => {
  const used = main.used.length
  const pane = ticketOf('pane')
  const full = ticketOf('full')
  const gotPane = await trade(main.port, pane)
  const gotFull = await trade(main.port, full)
  assert.equal(gotPane.status, 200)
  assert.equal(gotPane.grade, 'pane')
  assert.match(gotPane.handle, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(gotFull.grade, 'full')
  assert.notEqual(gotPane.handle, gotFull.handle)
  // each handle reads the state
  for (const handle of [gotPane.handle, gotFull.handle]) assert.equal((await request(main.port, { headers: { 'X-Deck-Handle': handle } })).status, 200)
  // one page per ticket: the same one again is refused, whatever its grade
  for (const ticket of [pane, full]) assert.deepEqual(await trade(main.port, ticket), { status: 403, ok: false, error: 'used' })
  // never sealed with this server's secret (an earlier start's, a guess), another shape, none
  const nonce = '00112233aabbccdd'
  for (const ticket of [ticketOf('full', nonce, 'another-secret-0123456789'), ticketOf('pane', nonce).replace(/^p/, 'f'), `full-${nonce}-${'0'.repeat(32)}`, ticketOf('full', 'xyz'), `${ticketOf('full', nonce)}x`, '', SECRET]) {
    assert.deepEqual(await trade(main.port, ticket), { status: 403, ok: false, error: 'unknown' }, ticket)
  }
  // another origin, or none: refused, and the ticket stays unused
  const fresh = ticketOf('full')
  assert.equal((await trade(main.port, fresh, { Origin: 'http://evil.example' })).status, 403)
  assert.equal((await trade(main.port, fresh, { Origin: '' })).status, 403)
  assert.equal((await trade(main.port, fresh)).status, 200)
  // a GET of it opens nothing
  assert.equal((await request(main.port, { path: '/session' })).status, 403)
  assert.equal((await request(main.port, { path: '/session', headers: authOf(main.port) })).status, 405)
  // the mod hears each trade by its nonce and grade, so a link it shows that was used is made anew
  await waitFor(main.on, () => (main.used.length >= used + 3 ? true : undefined), 2000, 'used lines')
  assert.deepEqual(main.used.slice(used), [{ used: pane.split('-')[1], grade: 'pane' }, { used: full.split('-')[1], grade: 'full' }, { used: fresh.split('-')[1], grade: 'full' }])
})

test('the seal is hooks/web.ts`s: a known secret and nonce give the ticket its test gives', () => {
  assert.equal(ticketOf('pane', '0011223344556677'), 'p-0011223344556677-adec674903d619b39d62c67a42bb3d17')
  assert.equal(ticketOf('full', '0011223344556677'), 'f-0011223344556677-a284df635f2f16617d5887d94954f3f8')
  assert.equal(ticketOf('full', '0011223344556677', SECRET, 0x6a000000), TIMED)
})

/** hooks/web.ts`s ticket with a deadline (tests/hold.test.ts gives the same): full, nonce 0011223344556677, until 0x6a000000. */
const TIMED = 'f-0011223344556677-6a000000-adda29be5226c4c28362ed400df5c76a'

test('a ticket with a deadline (the link the system`s opener opens) trades before it and is refused after it, as expired; its deadline is sealed, so one moved later is no ticket at all', async () => {
  const now = Math.floor(Date.now() / 1000)
  const soon = ticketOf('full', undefined, SECRET, now + 30)
  const got = await trade(main.port, soon)
  assert.equal(got.status, 200)
  assert.equal(got.grade, 'full')
  assert.deepEqual(await trade(main.port, soon), { status: 403, ok: false, error: 'used' })
  const late = ticketOf('full', undefined, SECRET, now - 1)
  assert.deepEqual(await trade(main.port, late), { status: 403, ok: false, error: 'expired' })
  // its deadline moved on, the seal kept: never sealed so
  const [letter, nonce, , seal] = late.split('-')
  assert.deepEqual(await trade(main.port, [letter, nonce, (now + 3600).toString(16), seal].join('-')), { status: 403, ok: false, error: 'unknown' })
})

test('each command printed carries the grade of the handle that sent it: pane from the Browser pane`s link, full from your own browser`s; a body that names a grade itself is refused', async () => {
  const { handle: pane } = await trade(main.port, ticketOf('pane'))
  const count = main.lines.length
  const chat = { cmd: 'chat', id: 'g-1', agentId: 'main', text: 'Ship it' }
  assert.equal((await post(main.port, chat, { 'X-Deck-Handle': pane })).status, 200)
  assert.equal((await post(main.port, { ...chat, id: 'g-2' })).status, 200)
  assert.equal((await post(main.port, { cmd: 'stopAgent', id: 'g-3', agentId: 'b81c6f3e2a9d4c17' }, { 'X-Deck-Handle': pane })).status, 200)
  for (const grade of ['full', 'pane']) assert.equal((await post(main.port, { ...chat, grade }, { 'X-Deck-Handle': pane })).status, 400, grade)
  assert.equal((await post(main.port, { cmd: 'chat', session: 'other-1', agentId: 'main', text: 'hi', grade: 'full' }, { 'X-Deck-Handle': pane })).status, 400)
  await waitFor(main.on, () => (main.lines.length >= count + 3 ? true : undefined), 2000, 'command lines')
  assert.deepEqual(main.lines.slice(count), [
    '{"cmd":"chat","id":"g-1","agentId":"main","text":"Ship it","grade":"pane"}',
    '{"cmd":"chat","id":"g-2","agentId":"main","text":"Ship it","grade":"full"}',
    '{"cmd":"stopAgent","id":"g-3","agentId":"b81c6f3e2a9d4c17","grade":"pane"}',
  ])
})

test('every start is a new secret: what an earlier server handed out, its tickets and its handles, opens nothing on the next', async () => {
  const first = await start({ dir: tempDir(), env: { APIARIUS_SECRET: 'first-secret-0123456789' }, handle: false })
  const ticket = ticketOf('full', undefined, 'first-secret-0123456789')
  const { handle } = await trade(first.port, ticket)
  assert.equal((await request(first.port, { headers: { 'X-Deck-Handle': handle } })).status, 200)
  first.child.kill()
  await exitOf(first, 3000)
  // the next start, on the same port, with its own secret: the page's old handle is refused (it says to open it again), and its link too
  const next = await start({ dir: tempDir(), env: { APIARIUS_SECRET: 'second-secret-0123456789' }, args: ['--port', String(first.port)], handle: false })
  assert.equal(next.port, first.port)
  assert.equal((await request(next.port, { headers: { 'X-Deck-Handle': handle } })).status, 403)
  assert.equal((await head(next.port, `/events?h=${handle}`)).status, 403)
  assert.deepEqual(await trade(next.port, ticket), { status: 403, ok: false, error: 'unknown' })
  assert.equal((await trade(next.port, ticketOf('full', undefined, 'second-secret-0123456789'))).status, 200)
  next.child.kill()
})

test('every answer: no framing (frame-ancestors none, X-Frame-Options DENY), no Referer, same-origin COOP and CORP, never cached or sniffed', async () => {
  for (const [target, headers] of [['/', {}], ['/app.js', {}], ['/state', authOf(main.port)], ['/state', {}], ['/nope', authOf(main.port)], ['/events', authOf(main.port)]]) {
    const res = await head(main.port, target, headers)
    assert.match(res.headers['content-security-policy'], /(^|; )frame-ancestors 'none'(;|$)/, target)
    assert.match(res.headers['content-security-policy'], /(^|; )script-src 'self'(;|$)/, target)
    assert.equal(res.headers['x-frame-options'], 'DENY', target)
    assert.equal(res.headers['referrer-policy'], 'no-referrer', target)
    assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin', target)
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin', target)
    assert.equal(res.headers['cache-control'], 'no-store', target)
    assert.equal(res.headers['x-content-type-options'], 'nosniff', target)
  }
})

test('421 on a Host other than 127.0.0.1:<port> or localhost:<port>', async () => {
  const auth = authOf(main.port)
  assert.equal((await request(main.port, { headers: { ...auth, Host: 'evil.example' } })).status, 421)
  assert.equal((await request(main.port, { headers: { ...auth, Host: `evil.example:${main.port}` } })).status, 421)
  assert.equal((await request(main.port, { headers: { ...auth, Host: '127.0.0.1:1' } })).status, 421)
  assert.equal((await request(main.port, { headers: { ...auth, Host: `localhost:${main.port}` } })).status, 200)
})

test('serves the page files with their types, no handle needed (app.js, every module it imports, the avatar library and the timeline`s layout scripts), or 404 while one is missing', async () => {
  const types = { '/': ['index.html', 'text/html'], '/app.css': ['app.css', 'text/css'] }
  for (const file of SCRIPTS) types[`/${file}`] = [file, 'text/javascript']
  for (const [target, [file, type]] of Object.entries(types)) {
    const res = await request(main.port, { path: target })
    if (!fs.existsSync(path.join(WEB, file))) { assert.equal(res.status, 404, target); continue }
    assert.equal(res.status, 200, target)
    assert.equal(res.headers['content-type'], `${type}; charset=utf-8`)
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.body, fs.readFileSync(path.join(WEB, file), 'utf8'))
  }
})

test('every page file is under 256 KiB: the plugin directory reviews a bigger one by hand', () => {
  for (const file of ['index.html', 'app.css', ...SCRIPTS]) assert.ok(fs.statSync(path.join(WEB, file)).size < 256 * 1024, file)
})

test('/state serves the current state; a missing or empty file serves {"v":1,"empty":true}', async () => {
  const res = await request(main.port, { headers: authOf(main.port) })
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.deepEqual(JSON.parse(res.body), STATE)
  const bareDir = tempDir()
  const bare = await start({ dir: bareDir })
  assert.equal((await request(bare.port, { headers: authOf(bare.port) })).body, EMPTY)
  fs.writeFileSync(path.join(bareDir, 'state.json'), '')
  await sleep(1300)
  assert.equal((await request(bare.port, { headers: authOf(bare.port) })).body, EMPTY)
})

test('SSE: the full state on connect, then an event after state.json is rewritten', async () => {
  const stream = await events(main.port)
  try {
    assert.equal(stream.res.statusCode, 200)
    assert.equal(stream.res.headers['content-type'], 'text/event-stream; charset=utf-8')
    assert.deepEqual(JSON.parse(await stream.next()), STATE)
    const next = { ...STATE, now: 2, agents: [{ id: 'main', status: 'done' }] }
    writeState(next)
    assert.deepEqual(JSON.parse(await stream.next()), next)
    writeState(next) // the same content again: no event
    await sleep(1300)
    assert.equal(stream.got.length, stream.read)
  } finally {
    stream.close()
  }
})

test('a half-written state.json is skipped, then read once complete', async () => {
  const stream = await events(main.port)
  try {
    const before = JSON.parse(await stream.next())
    writeState('{"v":1,"now":3,"agents":[{"id":"ma')
    await sleep(1300) // past the debounce and a poll
    assert.equal(stream.got.length, stream.read, 'no event for a torn file')
    assert.deepEqual(JSON.parse((await request(main.port, { headers: authOf(main.port) })).body), before)
    writeState('') // a truncate before the write is torn too, once a state was read
    await sleep(1300)
    assert.equal(stream.got.length, stream.read, 'no event for an emptied file')
    const whole = { ...STATE, now: 3 }
    writeState(whole)
    assert.deepEqual(JSON.parse(await stream.next()), whole)
  } finally {
    stream.close()
  }
})

test('/patch serves a patch by id and refuses anything else', async () => {
  const auth = authOf(main.port)
  const res = await request(main.port, { path: '/patch/toolu_01Abc-d_9', headers: auth })
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8')
  assert.equal(res.body, '@@ -1,1 +1,1 @@\n-old\n+new\n')
  assert.equal((await request(main.port, { path: '/patch/toolu_missing', headers: auth })).status, 404)
  for (const target of ['/patch/..%2Fsecret', '/patch/..%5Csecret', '/patch/%2e%2e%2fsecret', '/patch/..\\secret', '/patch/a.b', '/patch/', '/patch/CON', '/patch/../../secret', `/patch/${'a'.repeat(129)}`]) {
    const refused = await request(main.port, { path: target, headers: auth })
    assert.ok([400, 404].includes(refused.status), `${target} -> ${refused.status}`)
    assert.doesNotMatch(refused.body, /SECRET/)
  }
})

test('/gitdiff serves git`s own diff of a file by id, with a handle only, and refuses anything else', async () => {
  const auth = authOf(main.port)
  assert.equal((await request(main.port, { path: '/gitdiff/1kejm2g-1kfevo4-4g' })).status, 403)
  const res = await request(main.port, { path: '/gitdiff/1kejm2g-1kfevo4-4g', headers: auth })
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.equal(res.body, GIT_DIFF)
  assert.equal((await request(main.port, { path: '/gitdiff/1kejm2g-1kfevo4-4h', headers: auth })).status, 404)
  // a patch's id is no git diff's: each route reads its own folder
  assert.equal((await request(main.port, { path: '/gitdiff/toolu_01Abc-d_9', headers: auth })).status, 404)
  for (const target of ['/gitdiff/..%2Fsecret', '/gitdiff/..%5Csecret', '/gitdiff/%2e%2e%2fsecret', '/gitdiff/..\\secret', '/gitdiff/a.b', '/gitdiff/', '/gitdiff/PRN', '/gitdiff/../../secret', '/gitdiff/../patches/toolu_01Abc-d_9', `/gitdiff/${'a'.repeat(129)}`]) {
    const refused = await request(main.port, { path: target, headers: auth })
    assert.ok([400, 404].includes(refused.status), `${target} -> ${refused.status}`)
    assert.doesNotMatch(refused.body, /SECRET/)
  }
})

test('/message serves a cut message`s whole text by id, with a handle only, and refuses anything else', async () => {
  const auth = authOf(main.port)
  assert.equal((await request(main.port, { path: '/message/1791970900000-14-main-you' })).status, 403)
  const res = await request(main.port, { path: '/message/1791970900000-14-main-you', headers: auth })
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.equal(res.body, ANSWER)
  assert.equal((await request(main.port, { path: '/message/1791970900001-15-main-you', headers: auth })).status, 404)
  for (const target of ['/message/..%2Fsecret', '/message/..%5Csecret', '/message/%2e%2e%2fsecret', '/message/..\\secret', '/message/a.b', '/message/', '/message/NUL', '/message/../../secret', `/message/${'a'.repeat(129)}`]) {
    const refused = await request(main.port, { path: target, headers: auth })
    assert.ok([400, 404].includes(refused.status), `${target} -> ${refused.status}`)
    assert.doesNotMatch(refused.body, /SECRET/)
  }
})

test('/agent serves an agent`s page file by id as JSON, with a handle only, and refuses anything else', async () => {
  const auth = authOf(main.port)
  assert.equal((await request(main.port, { path: '/agent/b81c6f3e2a9d4c17' })).status, 403)
  const res = await request(main.port, { path: '/agent/b81c6f3e2a9d4c17', headers: auth })
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.equal(res.body, AGENT_FILE)
  assert.equal(JSON.parse((await request(main.port, { path: '/agent/main', headers: auth })).body).id, 'main')
  assert.equal((await request(main.port, { path: '/agent/a3f9c2e1b7d4058e', headers: auth })).status, 404)
  for (const target of ['/agent/..%2Fsecret', '/agent/..%5Csecret', '/agent/%2e%2e%2fsecret', '/agent/..\\secret', '/agent/main.json', '/agent/', '/agent/AUX', '/agent/../../secret', `/agent/${'a'.repeat(129)}`]) {
    const refused = await request(main.port, { path: target, headers: auth })
    assert.ok([400, 404].includes(refused.status), `${target} -> ${refused.status}`)
    assert.doesNotMatch(refused.body, /SECRET/)
  }
  // rewritten as the agent works: each read has what is on disk now
  const next = AGENT_FILE.replace('"result": ""', '"result": "Done."')
  fs.writeFileSync(path.join(dir, 'agents', 'b81c6f3e2a9d4c17.json'), next)
  assert.equal((await request(main.port, { path: '/agent/b81c6f3e2a9d4c17', headers: auth })).body, next)
})

test('/timeline serves Org`s Timeline (timeline.json beside the state) as JSON, with a handle only; none written yet is a 404', async () => {
  const auth = authOf(main.port)
  const file = path.join(dir, 'timeline.json')
  assert.equal((await request(main.port, { path: '/timeline', headers: auth })).status, 404)
  const text = '{"v":2,"now":1792013580000,"startedAt":1792011180000,"tools":["Read"],"lanes":[],"marks":[],"messages":[],"background":[]}\n'
  fs.writeFileSync(file, text)
  assert.equal((await request(main.port, { path: '/timeline' })).status, 403)
  const res = await request(main.port, { path: '/timeline', headers: auth })
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(res.body, text)
  for (const target of ['/timeline/', '/timeline/x', '/timeline.json', '/timelines']) assert.equal((await request(main.port, { path: target, headers: auth })).status, 404, target)
  fs.rmSync(file)
})

test('POST /cmd passes clearFinished and showCleared on in exactly their shapes (no field but the page`s id)', async () => {
  const count = main.lines.length
  const good = [{ cmd: 'clearFinished', id: 'cl-1' }, { cmd: 'clearFinished' }, { cmd: 'showCleared', id: 'cl-2' }, { cmd: 'showCleared' }]
  for (const body of good) assert.equal((await post(main.port, body)).status, 200, JSON.stringify(body))
  const bad = [
    { cmd: 'clearFinished', agentId: 'main' },
    { cmd: 'clearFinished', ids: ['a1'] },
    { cmd: 'clearFinished', id: 'bad id' },
    { cmd: 'showCleared', text: 'all' },
    { cmd: 'showCleared', id: 7 },
    { cmd: 'clearfinished' },
  ]
  for (const body of bad) assert.equal((await post(main.port, body)).status, 400, JSON.stringify(body))
  await waitFor(main.on, () => (main.lines.length >= count + good.length ? true : undefined), 2000, 'command lines')
  assert.deepEqual(main.lines.slice(count), ['{"cmd":"clearFinished","id":"cl-1","grade":"full"}', '{"cmd":"clearFinished","grade":"full"}', '{"cmd":"showCleared","id":"cl-2","grade":"full"}', '{"cmd":"showCleared","grade":"full"}'])
})

test('POST /cmd passes stopAgent and abortTurn on in exactly their shapes, with the page`s id', async () => {
  const count = main.lines.length
  const good = [
    { cmd: 'stopAgent', id: 's-1', agentId: 'b81c6f3e2a9d4c17' },
    { cmd: 'stopAgent', agentId: 'main' },
    { cmd: 'abortTurn', id: 't-1' },
    { cmd: 'abortTurn', id: 't-2', turnId: 'turn-7c1e' },
    { turnId: 'turn_8', cmd: 'abortTurn' },
  ]
  for (const body of good) assert.equal((await post(main.port, body)).status, 200, JSON.stringify(body))
  const bad = [
    { cmd: 'stopAgent' },
    { cmd: 'stopAgent', agentId: '' },
    { cmd: 'stopAgent', agentId: 42 },
    { cmd: 'stopAgent', agentId: 'ma\nin' },
    { cmd: 'stopAgent', agentId: 'x'.repeat(201) },
    { cmd: 'stopAgent', agentId: 'main', text: 'now' },
    { cmd: 'stopAgent', id: 'bad id', agentId: 'main' },
    { cmd: 'abortTurn', turnId: '' },
    { cmd: 'abortTurn', turnId: 'turn 7' },
    { cmd: 'abortTurn', turnId: '../turn' },
    { cmd: 'abortTurn', turnId: 'x'.repeat(101) },
    { cmd: 'abortTurn', turnId: 7 },
    { cmd: 'abortTurn', turnId: null },
    { cmd: 'abortTurn', agentId: 'main' },
  ]
  for (const body of bad) assert.equal((await post(main.port, body)).status, 400, JSON.stringify(body).slice(0, 80))
  await waitFor(main.on, () => (main.lines.length >= count + good.length ? true : undefined), 2000, 'command lines')
  assert.deepEqual(main.lines.slice(count), [
    '{"cmd":"stopAgent","id":"s-1","agentId":"b81c6f3e2a9d4c17","grade":"full"}',
    '{"cmd":"stopAgent","agentId":"main","grade":"full"}',
    '{"cmd":"abortTurn","id":"t-1","grade":"full"}',
    '{"cmd":"abortTurn","id":"t-2","turnId":"turn-7c1e","grade":"full"}',
    '{"cmd":"abortTurn","turnId":"turn_8","grade":"full"}',
  ])
})

test('POST /cmd passes stopBackground on in exactly its shape: a background row`s bgId, with the page`s id', async () => {
  const count = main.lines.length
  const good = [
    { cmd: 'stopBackground', id: 'st-1', bgId: 'bash_7' },
    { bgId: 'cron_4e1', cmd: 'stopBackground' },
  ]
  for (const body of good) assert.equal((await post(main.port, body)).status, 200, JSON.stringify(body))
  const bad = [
    { cmd: 'stopBackground' },
    { cmd: 'stopBackground', bgId: '' },
    { cmd: 'stopBackground', bgId: 'bash 7' },
    { cmd: 'stopBackground', bgId: '../bash_7' },
    { cmd: 'stopBackground', bgId: 7 },
    { cmd: 'stopBackground', bgId: 'x'.repeat(201) },
    { cmd: 'stopBackground', bgId: 'bash_7', agentId: 'main' },
  ]
  for (const body of bad) assert.equal((await post(main.port, body)).status, 400, JSON.stringify(body).slice(0, 80))
  await waitFor(main.on, () => (main.lines.length >= count + good.length ? true : undefined), 2000, 'command lines')
  assert.deepEqual(main.lines.slice(count), ['{"cmd":"stopBackground","id":"st-1","bgId":"bash_7","grade":"full"}', '{"cmd":"stopBackground","bgId":"cron_4e1","grade":"full"}'])
})

test('POST /cmd passes avatarStyle on in exactly its shape: a style`s id, lowercase letters, with the page`s id', async () => {
  const count = main.lines.length
  const good = [{ cmd: 'avatarStyle', id: 'a-1', style: 'critter' }, { style: 'robot', cmd: 'avatarStyle' }]
  for (const body of good) assert.equal((await post(main.port, body)).status, 200, JSON.stringify(body))
  const bad = [
    { cmd: 'avatarStyle' },
    { cmd: 'avatarStyle', style: '' },
    { cmd: 'avatarStyle', style: 'Robot' },
    { cmd: 'avatarStyle', style: 'pixel sprites' },
    { cmd: 'avatarStyle', style: '../robot' },
    { cmd: 'avatarStyle', style: 'x'.repeat(21) },
    { cmd: 'avatarStyle', style: 7 },
    { cmd: 'avatarStyle', style: 'mood', agentId: 'main' },
    { cmd: 'avatarStyle', id: 'bad id', style: 'mood' },
  ]
  for (const body of bad) assert.equal((await post(main.port, body)).status, 400, JSON.stringify(body).slice(0, 80))
  await waitFor(main.on, () => (main.lines.length >= count + good.length ? true : undefined), 2000, 'command lines')
  assert.deepEqual(main.lines.slice(count), ['{"cmd":"avatarStyle","id":"a-1","style":"critter","grade":"full"}', '{"cmd":"avatarStyle","style":"robot","grade":"full"}'])
})

test('POST /cmd passes selectRepo on in exactly its shape: a root on one line ("" follows the work), with the page`s id', async () => {
  const count = main.lines.length
  const good = [{ cmd: 'selectRepo', id: 'rp-1', root: 'C:/Users/sam/Documents/apiarius' }, { root: '', cmd: 'selectRepo' }]
  for (const body of good) assert.equal((await post(main.port, body)).status, 200, JSON.stringify(body))
  const bad = [
    { cmd: 'selectRepo' },
    { cmd: 'selectRepo', root: 7 },
    { cmd: 'selectRepo', root: 'C:/a\nC:/b' },
    { cmd: 'selectRepo', root: 'x'.repeat(1001) },
    { cmd: 'selectRepo', root: '/repo', agentId: 'main' },
    { cmd: 'selectRepo', id: 'bad id', root: '/repo' },
  ]
  for (const body of bad) assert.equal((await post(main.port, body)).status, 400, JSON.stringify(body).slice(0, 80))
  await waitFor(main.on, () => (main.lines.length >= count + good.length ? true : undefined), 2000, 'command lines')
  assert.deepEqual(main.lines.slice(count), ['{"cmd":"selectRepo","id":"rp-1","root":"C:/Users/sam/Documents/apiarius","grade":"full"}', '{"cmd":"selectRepo","root":"","grade":"full"}'])
})

test('POST /cmd: every command may carry the page`s id, which is printed with it; a bad id is refused', async () => {
  const count = main.lines.length
  const sent = [
    { cmd: 'chat', id: 'c-lz4k2-1ab9', agentId: 'main', text: 'And the changelog?' },
    { id: 'r_7', cmd: 'review', text: 'Review the diff' },
    { cmd: 'ping', id: 'p' },
    { cmd: 'chat', agentId: 'main', text: 'no id is fine too' },
  ]
  for (const body of sent) assert.equal((await post(main.port, body)).status, 200, JSON.stringify(body))
  const bad = [
    { cmd: 'ping', id: '' },
    { cmd: 'ping', id: 'x'.repeat(41) },
    { cmd: 'ping', id: 'has space' },
    { cmd: 'ping', id: 'a/b' },
    { cmd: 'ping', id: 7 },
    { cmd: 'ping', id: null },
    { cmd: 'chat', id: 'ok', agentId: 'main', text: 'hi', extra: true },
  ]
  for (const body of bad) assert.equal((await post(main.port, body)).status, 400, JSON.stringify(body))
  await waitFor(main.on, () => (main.lines.length >= count + 4 ? true : undefined), 2000, 'command lines')
  assert.deepEqual(main.lines.slice(count), [
    '{"cmd":"chat","id":"c-lz4k2-1ab9","agentId":"main","text":"And the changelog?","grade":"full"}',
    '{"cmd":"review","id":"r_7","text":"Review the diff","grade":"full"}',
    '{"cmd":"ping","id":"p","grade":"full"}',
    '{"cmd":"chat","agentId":"main","text":"no id is fine too","grade":"full"}',
  ])
})

test('POST /cmd checks an answer: a call id, 1 to 4 answers, each question and answer a string of at most 2000 characters', async () => {
  const count = main.lines.length
  const callId = 'toolu_01QmX7cR4vTn2LpB8sWkJ3hD'
  const good = [
    { cmd: 'answer', id: 'a-1', callId, answers: { 'Which store should the limiter use?': 'Redis' } },
    { cmd: 'answer', callId, answers: { 'Which routes skip it?': '/health, /metrics', 'Default limit?': 'Keep 100 a minute, but\nlet ops change it' } },
    { cmd: 'answer', id: 'a-3', callId, answers: { a: '1', b: '2', c: '3', d: 'x'.repeat(2000) } },
  ]
  for (const body of good) assert.equal((await post(main.port, body)).status, 200, JSON.stringify(body).slice(0, 80))
  const bad = [
    { cmd: 'answer', answers: { q: 'a' } },
    { cmd: 'answer', callId: '', answers: { q: 'a' } },
    { cmd: 'answer', callId: 'toolu 01', answers: { q: 'a' } },
    { cmd: 'answer', callId: '../x', answers: { q: 'a' } },
    { cmd: 'answer', callId: 'x'.repeat(101), answers: { q: 'a' } },
    { cmd: 'answer', callId: 42, answers: { q: 'a' } },
    { cmd: 'answer', callId },
    { cmd: 'answer', callId, answers: {} },
    { cmd: 'answer', callId, answers: null },
    { cmd: 'answer', callId, answers: ['Redis'] },
    { cmd: 'answer', callId, answers: 'Redis' },
    { cmd: 'answer', callId, answers: { a: '1', b: '2', c: '3', d: '4', e: '5' } },
    { cmd: 'answer', callId, answers: { q: 'x'.repeat(2001) } },
    { cmd: 'answer', callId, answers: { ['q'.repeat(2001)]: 'a' } },
    { cmd: 'answer', callId, answers: { q: '   ' } },
    { cmd: 'answer', callId, answers: { ' ': 'a' } },
    { cmd: 'answer', callId, answers: { q: 2 } },
    { cmd: 'answer', callId, answers: { q: ['a', 'b'] } },
    { cmd: 'answer', callId, answers: { q: 'a' }, text: 'extra' },
    { cmd: 'answer', id: 'bad id', callId, answers: { q: 'a' } },
  ]
  for (const body of bad) assert.equal((await post(main.port, body)).status, 400, JSON.stringify(body).slice(0, 80))
  await waitFor(main.on, () => (main.lines.length >= count + 3 ? true : undefined), 2000, 'command lines')
  const printed = main.lines.slice(count)
  assert.equal(printed.length, 3, 'only the good ones were printed')
  assert.deepEqual(printed.map(line => JSON.parse(line)), good.map(body => ({ ...body, grade: 'full' })))
  assert.equal(printed[0], `{"cmd":"answer","id":"a-1","callId":"${callId}","answers":{"Which store should the limiter use?":"Redis"},"grade":"full"}`)
  assert.ok(printed.every(line => !line.includes('\n')))
})

test('POST /cmd refuses another origin and a missing handle header', async () => {
  const ping = { cmd: 'ping' }
  const cookie = `deck_h_${main.port}=${main.handle}`
  assert.equal((await post(main.port, ping, { Origin: 'http://evil.example' })).status, 403)
  assert.equal((await post(main.port, ping, { Origin: `http://localhost:${main.port}` })).status, 403) // not the Host it was sent to
  assert.equal((await post(main.port, ping, { Origin: '' })).status, 403)
  assert.equal((await post(main.port, ping, { 'X-Deck-Handle': '', Cookie: cookie })).status, 403) // a cookie is not enough
  assert.equal((await post(main.port, ping, { 'X-Deck-Handle': 'wrong-handle-0123456789' })).status, 403)
  assert.equal((await post(main.port, ping, { 'X-Deck-Handle': '', 'X-Deck-Ticket': ticketOf('full') })).status, 403) // a ticket is traded first
  const count = main.lines.length
  assert.equal((await post(main.port, { cmd: 'ping' })).status, 200)
  await waitFor(main.on, () => (main.lines.length > count ? true : undefined), 2000, 'command line')
  assert.deepEqual(main.lines.slice(count), ['{"cmd":"ping","grade":"full"}'], 'only the allowed one was printed')
})

test('POST /cmd prints each valid command to stdout as one line', async () => {
  const count = main.lines.length
  const sent = [
    { cmd: 'chat', agentId: 'a3f9c21b', text: 'Use the memory store.\nNot Redis.' },
    { text: 'Review the diff in src/app.ts', cmd: 'review' },
    { cmd: 'ping' },
  ]
  for (const body of sent) {
    const res = await post(main.port, body)
    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body), { ok: true })
  }
  await waitFor(main.on, () => (main.lines.length >= count + 3 ? true : undefined), 2000, 'command lines')
  assert.deepEqual(main.lines.slice(count), [
    '{"cmd":"chat","agentId":"a3f9c21b","text":"Use the memory store.\\nNot Redis.","grade":"full"}',
    '{"cmd":"review","text":"Review the diff in src/app.ts","grade":"full"}',
    '{"cmd":"ping","grade":"full"}',
  ])
})

test('POST /cmd refuses malformed, unknown and oversized commands', async () => {
  const count = main.lines.length
  const bad = [
    '{"cmd":"ping"', 'null', '[]', '"ping"',
    { cmd: 'shell', text: 'rm -rf /' },
    { cmd: 'ping', extra: 1 },
    { cmd: 'chat', text: 'no agent' },
    { cmd: 'chat', agentId: 'main', text: '   ' },
    { cmd: 'chat', agentId: 'main', text: 'x'.repeat(4001) },
    { cmd: 'chat', agentId: 'ma\nin', text: 'hi' },
    { cmd: 'review', text: 42 },
  ]
  for (const body of bad) assert.equal((await post(main.port, body)).status, 400, JSON.stringify(body).slice(0, 60))
  assert.equal((await post(main.port, { cmd: 'review', text: 'x'.repeat(17 * 1024) })).status, 413)
  assert.equal((await request(main.port, { path: '/cmd', headers: authOf(main.port) })).status, 405)
  assert.equal((await post(main.port, { cmd: 'ping' })).status, 200)
  await waitFor(main.on, () => (main.lines.length > count ? true : undefined), 2000, 'command line')
  assert.deepEqual(main.lines.slice(count), ['{"cmd":"ping","grade":"full"}'], 'nothing refused was printed')
})

test('exits when the --parent process dies', { timeout: 15000 }, async () => {
  const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
  children.add(parent)
  const server = await start({ dir: tempDir(), args: ['--parent', String(parent.pid)] })
  await sleep(300)
  assert.equal(server.exited, false)
  parent.kill()
  assert.equal(await exitOf(server, 6000), 0)
})

test('exits when its stdin closes', async () => {
  const server = await start({ dir: tempDir() })
  await sleep(1200) // a close in the first second is a stdin closed from the start
  assert.equal(server.exited, false)
  server.child.stdin.end()
  assert.equal(await exitOf(server, 3000), 0)
})

test('stays up when its stdin is closed from the start, or the null device', async () => {
  for (const stdin of ['closed', 'ignore']) {
    const server = await start({ dir: tempDir(), stdin })
    await sleep(1500)
    assert.equal(server.exited, false, stdin)
    assert.equal((await request(server.port, { headers: authOf(server.port) })).status, 200, stdin)
    server.child.kill()
  }
})

test('--port takes the port asked for, or one the OS picks when it is taken', async () => {
  const taken = await start({ dir: tempDir(), args: ['--port', String(main.port)] })
  assert.notEqual(taken.port, main.port)
  const free = taken.port
  taken.child.kill()
  await exitOf(taken, 3000)
  const again = await start({ dir: tempDir(), args: ['--port', String(free)] })
  assert.equal(again.port, free)
  assert.equal((await request(free, { headers: authOf(free) })).status, 200)
})

test('exits on SIGTERM', async () => {
  const server = await start({ dir: tempDir() })
  server.child.kill('SIGTERM')
  const code = await exitOf(server, 3000)
  if (process.platform !== 'win32') assert.equal(code, 0) // Windows has no SIGTERM: kill() terminates it outright
})

test('a FIFO planted where a file is read never holds the server: its state, a patch and another session`s state answer at once, and a plain file still does after many such reads', { skip: process.platform === 'win32' }, async () => {
  const { execFileSync } = require('node:child_process')
  const root = tempDir()
  const own = path.join(root, 'web', 'session-fifo')
  const other = path.join(root, 'web', 'other-fifo')
  const registry = path.join(root, 'sessions')
  for (const folder of [path.join(own, 'patches'), path.join(other, 'patches'), registry]) fs.mkdirSync(folder, { recursive: true })
  execFileSync('mkfifo', [path.join(own, 'state.json')])
  execFileSync('mkfifo', [path.join(own, 'patches', 'pipe.diff')])
  execFileSync('mkfifo', [path.join(other, 'state.json')])
  fs.writeFileSync(path.join(own, 'patches', 'plain.diff'), '+ok\n')
  fs.writeFileSync(path.join(registry, 'other-fifo.json'), JSON.stringify({ id: 'other-fifo', heartbeatAt: Date.now() }))
  const server = await start({ dir: own, args: ['--sessions', registry] })
  const auth = authOf(server.port)
  const started = Date.now()
  assert.equal((await request(server.port, { headers: auth })).body, EMPTY)
  const reads = await Promise.all(Array.from({ length: 12 }, () => request(server.port, { path: '/patch/pipe', headers: auth })))
  assert.ok(reads.every(res => res.status === 404))
  assert.equal((await request(server.port, { path: '/s/other-fifo/state', headers: auth })).body, EMPTY)
  const plain = await request(server.port, { path: '/patch/plain', headers: auth })
  assert.equal(plain.status, 200)
  assert.equal(plain.body, '+ok\n')
  assert.ok(Date.now() - started < 5000, 'a FIFO held a read')
})
