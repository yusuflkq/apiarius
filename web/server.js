/**
 * The Agent Deck web server: serves the dashboard page, the session's state
 * and patches, live updates over SSE, and turns the page's commands into
 * stdout lines for the mod. web/CONTRACT.md is the spec.
 *
 *   AGENT_DECK_TOKEN=<token> node web/server.js --dir <mod root>/.web/<sessionId> --parent <pid>
 *
 * Plain Node (18+), no dependencies. stdout carries the ready line
 * `{"ready":<port>}` and then one `{"cmd":…}` line per command, nothing else;
 * diagnostics go to stderr. It exits with the parent, on a signal, or when
 * its stdin pipe closes.
 */
'use strict'
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const net = require('net')

const EMPTY = '{"v":1,"empty":true}'
const MAX_BODY = 16 * 1024
const MAX_TEXT = 4000
const PATCH_ID = /^[A-Za-z0-9_-]{1,128}$/
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)$/i // Windows device names: never open them as files
const JSON_TYPE = 'application/json; charset=utf-8'
const TEXT_TYPE = 'text/plain; charset=utf-8'
const PAGE = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
}
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
// Scripts only from app.js, so agent text the page shows can never run as code.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

// ---- the command line, and the token (from the environment, never argv)
const log = message => process.stderr.write(`agent-deck server: ${message}\n`)
const fail = message => { log(message); process.exit(2) }

const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  if (!['--dir', '--parent', '--port'].includes(key) || process.argv[i + 1] === undefined) fail('usage: node server.js --dir <dir> [--parent <pid>] [--port <port>]')
  args[key.slice(2)] = process.argv[i + 1]
}
if (!args.dir) fail('--dir is required')
const dir = path.resolve(args.dir)
const parent = args.parent === undefined ? null : Number(args.parent)
if (parent !== null && !(Number.isInteger(parent) && parent > 0)) fail('--parent must be a pid')
// A restart asks for its last port again, so the open page reconnects; when it is taken the OS picks one.
let wanted = args.port === undefined ? 0 : Number(args.port)
if (!(Number.isInteger(wanted) && wanted >= 0 && wanted < 65536)) fail('--port must be a port number')
const token = process.env.AGENT_DECK_TOKEN ?? ''
if (token.length < 16) fail('AGENT_DECK_TOKEN must be set (16 characters or more)')

// Compares digests, so a check takes the same time whatever the guess.
const digest = text => crypto.createHash('sha256').update(text).digest()
const TOKEN = digest(token)
const isToken = value => typeof value === 'string' && value !== '' && crypto.timingSafeEqual(digest(value), TOKEN)

// Cookies ignore ports, so each server names its own: two sessions' decks on
// 127.0.0.1 must not overwrite each other's token. Both are set on listen.
let port = 0
let cookie = 'deck_t'

function cookieOf(req) {
  const pair = (req.headers.cookie ?? '').split(/;\s*/).find(part => part.startsWith(`${cookie}=`))
  try { return pair ? decodeURIComponent(pair.slice(cookie.length + 1)) : '' } catch { return '' }
}

// ---- the state: the last good state.json, minified so it fits one SSE data line
const stateFile = path.join(dir, 'state.json')
let state = EMPTY // what /state and /events serve
let seen = '' // the signature of the file `state` was read from
let hasState = false // after a real state, an empty file is a write in progress

function signature() {
  try { const stat = fs.statSync(stateFile); return `${stat.mtimeMs}:${stat.size}` } catch { return 'missing' }
}

/**
 * Re-reads state.json; true when what we serve changed. The mod's writes are
 * not atomic, so a half-written file is skipped: `seen` stays as it was, and
 * the next change or poll reads it again.
 */
function reload() {
  const sig = signature() // before the read: a write after it shows up as a new signature
  let next = EMPTY
  if (sig !== 'missing') {
    let text
    try { text = fs.readFileSync(stateFile, 'utf8').trim() } catch { return false } // trim() drops a BOM too
    if (text !== '') {
      let value
      try { value = JSON.parse(text) } catch { return false }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
      next = JSON.stringify(value)
      hasState = true
    } else if (hasState) {
      return false
    }
  }
  seen = sig
  if (next === state) return false
  state = next
  return true
}

// ---- live updates: fs.watch on the dir with a 100 ms debounce, plus a 1 s
// mtime poll, because on Windows fs.watch can fire twice or miss a rename
const clients = new Set()
let debounce = null
let watcher = null

function changed() {
  clearTimeout(debounce)
  debounce = setTimeout(() => {
    if (!reload()) return
    for (const res of clients) res.write(`event: state\ndata: ${state}\n\n`)
  }, 100)
}

function watch() {
  if (watcher) return
  try {
    watcher = fs.watch(dir, (_, name) => { if (!name || name === 'state.json') changed() })
    watcher.on('error', () => { watcher?.close(); watcher = null }) // the poll sets it up again
  } catch {} // no dir yet: the poll retries
}

reload()
watch()
setInterval(() => { watch(); if (signature() !== seen) changed() }, 1000)
setInterval(() => { for (const res of clients) res.write(': ping\n\n') }, 15000)

// ---- the routes
function send(res, status, body = '', type = TEXT_TYPE) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function page(res, [file, type]) {
  fs.readFile(path.join(__dirname, file), (err, body) => {
    if (err) return send(res, 404, `${file} is missing\n`)
    if (file === 'index.html') res.setHeader('Content-Security-Policy', CSP)
    send(res, 200, body, type)
  })
}

function events(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' })
  req.socket.setNoDelay(true)
  res.write(`retry: 1000\nevent: state\ndata: ${state}\n\n`)
  clients.add(res)
  req.on('close', () => clients.delete(res))
}

function patch(res, id) {
  if (!PATCH_ID.test(id) || DEVICE.test(id)) return send(res, 400, 'bad patch id\n')
  fs.readFile(path.join(dir, 'patches', `${id}.diff`), 'utf8', (err, text) => (err ? send(res, 404, 'no such patch\n') : send(res, 200, text)))
}

/** The command a body holds, rebuilt from exactly its known keys; null for any other shape. */
function commandOf(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value).sort().join(',')
  const isText = text => typeof text === 'string' && text.trim() !== '' && text.length <= MAX_TEXT
  const isId = id => typeof id === 'string' && /^[^\u0000-\u001f\u007f]{1,200}$/.test(id)
  if (value.cmd === 'ping' && keys === 'cmd') return { cmd: 'ping' }
  if (value.cmd === 'review' && keys === 'cmd,text' && isText(value.text)) return { cmd: 'review', text: value.text }
  if (value.cmd === 'chat' && keys === 'agentId,cmd,text' && isId(value.agentId) && isText(value.text)) return { cmd: 'chat', agentId: value.agentId, text: value.text }
  return null
}

/** POST /cmd: only the page itself may send one (the token header, which no other site can set, and its own Origin). */
function command(req, res, host) {
  if (!isToken(req.headers['x-deck-token']) || (req.headers.origin ?? '').toLowerCase() !== `http://${host}`) {
    return send(res, 403, '{"ok":false,"error":"forbidden"}', JSON_TYPE)
  }
  const tooBig = () => { send(res, 413, '{"ok":false,"error":"too large"}', JSON_TYPE); req.resume() }
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return tooBig()
  const chunks = []
  let size = 0
  req.on('data', chunk => {
    if (size > MAX_BODY) return // answered already: drain the rest
    size += chunk.length
    if (size > MAX_BODY) tooBig()
    else chunks.push(chunk)
  })
  req.on('end', () => {
    if (size > MAX_BODY) return
    let cmd = null
    try { cmd = commandOf(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch {}
    if (!cmd) return send(res, 400, '{"ok":false,"error":"bad command"}', JSON_TYPE)
    process.stdout.write(`${JSON.stringify(cmd)}\n`) // one line: JSON.stringify escapes every newline
    send(res, 200, '{"ok":true}', JSON_TYPE)
  })
}

function handle(req, res) {
  for (const [name, value] of Object.entries(HEADERS)) res.setHeader(name, value)
  // A site that points its own name at 127.0.0.1 (DNS rebinding) still sends that name as the Host.
  const host = (req.headers.host ?? '').toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 421, 'misdirected request\n')
  const url = new URL(`http://deck${req.url.startsWith('/') ? req.url : `/${req.url}`}`) // '//x' stays a path, never a host
  const route = url.pathname
  if (route === '/cmd' && req.method === 'POST') return command(req, res, host)

  // Everything else needs the token: the `t` param on the first load (it sets the cookie), then the cookie or the header.
  const fromQuery = url.searchParams.get('t')
  const fromCookie = cookieOf(req)
  if (!isToken(req.headers['x-deck-token']) && !isToken(fromCookie) && !isToken(fromQuery)) return send(res, 403, 'forbidden\n')
  if (isToken(fromQuery) && !isToken(fromCookie)) res.setHeader('Set-Cookie', `${cookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`)

  if (req.method !== 'GET' || route === '/cmd') {
    res.setHeader('Allow', route === '/cmd' ? 'POST' : 'GET')
    return send(res, 405, 'method not allowed\n')
  }
  if (PAGE[route]) return page(res, PAGE[route])
  if (route === '/state') return send(res, 200, state, JSON_TYPE)
  if (route === '/events') return events(req, res)
  if (route.startsWith('/patch/')) return patch(res, route.slice('/patch/'.length))
  if (route === '/favicon.ico') return res.writeHead(204).end()
  send(res, 404, 'not found\n')
}

const server = http.createServer((req, res) => {
  try { handle(req, res) } catch (err) {
    log(err?.stack ?? err)
    if (!res.headersSent) send(res, 500, 'server error\n')
  }
})

// ---- lifetime: leave with the session. Windows does not kill a child with
// its parent, so watch the parent's pid; stdin closing is the faster signal.
const quit = () => process.exit(0)

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' } // EPERM: alive, just not ours
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK']) process.on(signal, quit)
process.stdout.on('error', quit) // EPIPE: nobody reads the commands any more
// Only a pipe that closes later says the parent let go. stdin 'ignore' (the null
// device) or a pipe closed from the start (the mod's $.process.spawn) ends at
// once, and a terminal belongs to a person: those leave it to the pid check.
if (process.stdin instanceof net.Socket && !process.stdin.isTTY) {
  const ended = () => { if (process.uptime() > 1) quit() }
  process.stdin.on('end', ended).on('close', ended).on('error', ended).resume()
}
if (parent !== null) {
  if (!isAlive(parent)) quit()
  setInterval(() => { if (!isAlive(parent)) quit() }, 2000)
}

server.on('listening', () => {
  port = server.address().port
  cookie = `deck_t_${port}`
  process.stdout.write(`${JSON.stringify({ ready: port })}\n`)
})
// A reload's killed server can hold its port for a moment, and the open page
// reconnects only to that port: retry it for about a second before letting
// the OS pick another.
let portRetries = 5
server.on('error', err => {
  if (wanted !== 0 && err.code === 'EADDRINUSE' && portRetries-- > 0) {
    setTimeout(() => server.listen(wanted, '127.0.0.1'), 200)
    return
  }
  if (wanted !== 0 && ['EADDRINUSE', 'EACCES'].includes(err.code)) return server.listen((wanted = 0), '127.0.0.1')
  log(err.message)
  process.exit(1)
})
server.listen(wanted, '127.0.0.1')
