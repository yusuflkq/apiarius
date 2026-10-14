/**
 * The web server against a temp dir, end to end: `node --test web/test/`.
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

const SERVER = path.join(__dirname, '..', 'server.js')
const TOKEN = 'test-token-0123456789abcdef'
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
 * once, as the mod's $.process.spawn gives it), or 'ignore'.
 */
function start({ dir, args = [], stdin = 'pipe', env = { AGENT_DECK_TOKEN: TOKEN } } = {}) {
  const argv = [SERVER, '--dir', dir, ...args]
  const child = spawn(process.execPath, argv, { env: { ...process.env, AGENT_DECK_TOKEN: '', ...env }, stdio: [stdin === 'closed' ? 'pipe' : stdin, 'pipe', 'pipe'], windowsHide: true })
  if (stdin === 'closed') child.stdin.end()
  children.add(child)
  const server = { child, lines: [], first: null, port: 0, stderr: '', exited: false, listeners: new Set() }
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
      else server.lines.push(line)
    }
    notify()
  })
  child.stderr.on('data', chunk => { server.stderr += chunk })
  child.on('exit', code => { server.exited = true; server.code = code; children.delete(child); notify() })
  return waitFor(server.on, () => {
    if (server.first !== null) { server.port = JSON.parse(server.first).ready; return server }
    if (server.exited) throw new Error(`the server exited with ${server.code}: ${server.stderr}`)
  }, 5000, 'ready line')
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
function events(port, headers = { 'X-Deck-Token': TOKEN }) {
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
  headers: { 'Content-Type': 'application/json', 'X-Deck-Token': TOKEN, Origin: `http://127.0.0.1:${port}`, ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

// ---- one server for most tests, over a dir with a state and a patch

let dir = ''
let main = null
const writeState = value => fs.writeFileSync(path.join(dir, 'state.json'), typeof value === 'string' ? value : JSON.stringify(value, null, 2))

before(async () => {
  const root = tempDir()
  dir = path.join(root, 'session')
  fs.mkdirSync(path.join(dir, 'patches'), { recursive: true })
  fs.writeFileSync(path.join(root, 'secret.diff'), 'SECRET')
  fs.writeFileSync(path.join(dir, 'patches', 'toolu_01Abc-d_9.diff'), '@@ -1,1 +1,1 @@\n-old\n+new\n')
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

test('refuses to start without a token, or with bad arguments', async () => {
  await assert.rejects(start({ dir: tempDir(), env: {} }), /exited with 2/)
  await assert.rejects(start({ dir: tempDir(), env: { AGENT_DECK_TOKEN: 'short' } }), /exited with 2/)
  await assert.rejects(start({ dir: tempDir(), args: ['--parent', 'abc'] }), /exited with 2/)
  await assert.rejects(start({ dir: tempDir(), args: ['--port', '70000'] }), /exited with 2/)
  await assert.rejects(start({ dir: tempDir(), args: ['--verbose', '1'] }), /exited with 2/)
})

test('prints the ready line first, with the port it listens on', async () => {
  assert.match(main.first, /^\{"ready":\d+\}$/)
  assert.ok(main.port > 0)
  assert.equal((await request(main.port, { headers: { 'X-Deck-Token': TOKEN } })).status, 200)
})

test('refuses every route without the token (403), and answers with it', async () => {
  for (const target of ['/', '/app.js', '/app.css', '/state', '/events', '/patch/toolu_01Abc-d_9', '/nope']) {
    assert.equal((await request(main.port, { path: target })).status, 403, target)
    assert.equal((await request(main.port, { path: target, headers: { 'X-Deck-Token': 'wrong-token-0123456789' } })).status, 403, target)
  }
  const res = await request(main.port, { headers: { 'X-Deck-Token': TOKEN } })
  assert.equal(res.status, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('the t param sets an HttpOnly SameSite=Strict cookie, which then carries the token', async () => {
  const first = await request(main.port, { path: `/state?t=${TOKEN}` })
  assert.equal(first.status, 200)
  const [cookie] = first.headers['set-cookie']
  assert.match(cookie, new RegExp(`^deck_t_${main.port}=${TOKEN};`))
  assert.match(cookie, /; HttpOnly/)
  assert.match(cookie, /; SameSite=Strict/)
  const pair = cookie.split(';')[0]
  const again = await request(main.port, { headers: { Cookie: `other=1; ${pair}` } })
  assert.equal(again.status, 200)
  assert.equal(again.headers['set-cookie'], undefined) // already set
  assert.equal((await request(main.port, { headers: { Cookie: `deck_t_${main.port}=wrong-token-0123456789` } })).status, 403)
  assert.equal((await request(main.port, { headers: { Cookie: `deck_t_1=${TOKEN}` } })).status, 403) // another server's cookie
  assert.equal((await request(main.port, { path: '/state?t=wrong-token-0123456789' })).status, 403)
})

test('421 on a Host other than 127.0.0.1:<port> or localhost:<port>', async () => {
  const auth = { 'X-Deck-Token': TOKEN }
  assert.equal((await request(main.port, { headers: { ...auth, Host: 'evil.example' } })).status, 421)
  assert.equal((await request(main.port, { headers: { ...auth, Host: `evil.example:${main.port}` } })).status, 421)
  assert.equal((await request(main.port, { headers: { ...auth, Host: '127.0.0.1:1' } })).status, 421)
  assert.equal((await request(main.port, { headers: { ...auth, Host: `localhost:${main.port}` } })).status, 200)
})

test('serves the page files with their types, or 404 while one is missing', async () => {
  const types = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'] }
  for (const [target, [file, type]] of Object.entries(types)) {
    const res = await request(main.port, { path: target, headers: { 'X-Deck-Token': TOKEN } })
    if (!fs.existsSync(path.join(__dirname, '..', file))) { assert.equal(res.status, 404, target); continue }
    assert.equal(res.status, 200, target)
    assert.equal(res.headers['content-type'], `${type}; charset=utf-8`)
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.body, fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))
  }
})

test('/state serves the current state; a missing or empty file serves {"v":1,"empty":true}', async () => {
  const res = await request(main.port, { headers: { 'X-Deck-Token': TOKEN } })
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.deepEqual(JSON.parse(res.body), STATE)
  const bareDir = tempDir()
  const bare = await start({ dir: bareDir })
  assert.equal((await request(bare.port, { headers: { 'X-Deck-Token': TOKEN } })).body, EMPTY)
  fs.writeFileSync(path.join(bareDir, 'state.json'), '')
  await sleep(1300)
  assert.equal((await request(bare.port, { headers: { 'X-Deck-Token': TOKEN } })).body, EMPTY)
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
    assert.deepEqual(JSON.parse((await request(main.port, { headers: { 'X-Deck-Token': TOKEN } })).body), before)
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
  const auth = { 'X-Deck-Token': TOKEN }
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

test('POST /cmd refuses another origin and a missing token header', async () => {
  const ping = { cmd: 'ping' }
  const cookie = `deck_t_${main.port}=${TOKEN}`
  assert.equal((await post(main.port, ping, { Origin: 'http://evil.example' })).status, 403)
  assert.equal((await post(main.port, ping, { Origin: `http://localhost:${main.port}` })).status, 403) // not the Host it was sent to
  assert.equal((await post(main.port, ping, { Origin: '' })).status, 403)
  assert.equal((await post(main.port, ping, { 'X-Deck-Token': '', Cookie: cookie })).status, 403) // a cookie is not enough
  assert.equal((await post(main.port, ping, { 'X-Deck-Token': 'wrong-token-0123456789' })).status, 403)
  const count = main.lines.length
  assert.equal((await post(main.port, { cmd: 'ping' })).status, 200)
  await waitFor(main.on, () => (main.lines.length > count ? true : undefined), 2000, 'command line')
  assert.deepEqual(main.lines.slice(count), ['{"cmd":"ping"}'], 'only the allowed one was printed')
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
    '{"cmd":"chat","agentId":"a3f9c21b","text":"Use the memory store.\\nNot Redis."}',
    '{"cmd":"review","text":"Review the diff in src/app.ts"}',
    '{"cmd":"ping"}',
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
  assert.equal((await request(main.port, { path: '/cmd', headers: { 'X-Deck-Token': TOKEN } })).status, 405)
  assert.equal((await post(main.port, { cmd: 'ping' })).status, 200)
  await waitFor(main.on, () => (main.lines.length > count ? true : undefined), 2000, 'command line')
  assert.deepEqual(main.lines.slice(count), ['{"cmd":"ping"}'], 'nothing refused was printed')
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
    assert.equal((await request(server.port, { headers: { 'X-Deck-Token': TOKEN } })).status, 200, stdin)
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
  assert.equal((await request(free, { headers: { 'X-Deck-Token': TOKEN } })).status, 200)
})

test('exits on SIGTERM', async () => {
  const server = await start({ dir: tempDir() })
  server.child.kill('SIGTERM')
  const code = await exitOf(server, 3000)
  if (process.platform !== 'win32') assert.equal(code, 0) // Windows has no SIGTERM: kill() terminates it outright
})
