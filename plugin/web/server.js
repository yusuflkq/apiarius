/**
 * The Apiarius web server: serves the page, the session's state, its
 * patches, git's own diffs of the uncommitted files, the whole text of
 * messages cut for the state and the agents' page files, live updates over
 * SSE, and turns the page's commands into stdout lines for the mod.
 *
 *   node web/server.js --dir <home>/web/<sessionId> --parent <pid> [--sessions <registry>]   (the secret on stdin)
 *
 * The secret comes as the first line of stdin (the mod's `input`), or from
 * `APIARIUS_SECRET` (web/dev.js and the tests): never argv, which other
 * processes can read. The mod makes a new one for every start, so nothing an
 * earlier server handed out works on this one.
 *
 * Access, in two steps. The mod signs one-time tickets with the secret
 * (`ticketOf`: HMAC-SHA256, hooks/web.ts mints the same), each of a grade:
 * `pane` for the page it opens in the Desktop's Browser pane, which Claude's
 * tools can drive, and `full` for the user's own browser. A link carries
 * one as `t`; the page trades it at once (POST /session, the ticket in the
 * `X-Deck-Ticket` header) for a handle of the same grade. A ticket is refused
 * once used (the mod hears of each use: `{"used":…}`), and so is one past the
 * deadline sealed into it (the link the system's opener opens carries a 30 s
 * one, since other programs can read the opener's arguments while it runs). Every data
 * route and POST /cmd needs a handle, in the `X-Deck-Handle` header, or as
 * `h` for /events alone (an EventSource sends no header); the page's own
 * files (index.html, app.js, app.css, the .mjs it imports) hold no data and
 * need none, so no cookie is ever set. Each command printed carries the
 * grade of the handle that sent it (`grade`), which the mod trusts: it holds
 * a `pane` page's words until the user presses Send above the prompt.
 *
 * With `--sessions` (the registry of every session on this machine,
 * hooks/sessions.ts) it also serves another session's state and lazy files
 * under /s/<sessionId>/…, read from the folder its registry file names, and
 * only from a folder beside its own as the deck makes them
 * (`<home>/web/<sessionId>`, still there once every link is followed).
 *
 * Plain Node (22+), no dependencies. stdout carries the ready line
 * `{"ready":<port>}`, then one `{"cmd":…,"grade":…}` line per command and one
 * `{"used":<nonce>,"grade":…}` line per ticket traded, nothing else;
 * diagnostics go to stderr. It exits with the parent, on a signal, or when
 * its stdin pipe closes.
 */
'use strict'
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const net = require('net')
const NOFOLLOW = fs.constants.O_NOFOLLOW || 0
// a FIFO planted where a file is read never holds the open: what opened is read only as a regular file
const NONBLOCK = fs.constants.O_NONBLOCK || 0
const MAX_FILE = 16 * 1024 * 1024 // the most of a file the server reads: what the mod writes is far less

const EMPTY = '{"v":1,"empty":true}'
const MAX_BODY = 16 * 1024
const MAX_CLIENTS = 50 // the live (SSE) connections at once: the page keeps one; a cap so no client holds them all
const MAX_HANDLES = 64 // the handles kept at once (a page each, a reload keeps its own): past it the oldest goes
const MAX_USED = 10_000 // the tickets remembered as used: past it every ticket is refused (no secret lives that long)
const TICKET = /^([pf])-([0-9a-f]{16})(?:-([0-9a-f]{8}))?-([0-9a-f]{32})$/ // a ticket: its grade (p: pane, f: full), its nonce, the second it works until (none: no deadline), its seal (hooks/web.ts ticketOf)
const GRADES = { p: 'pane', f: 'full' }
const HANDLE = /^[A-Za-z0-9_-]{43}$/ // a handle: 32 random bytes, base64url
const MAX_TEXT = 4000
const MAX_ANSWERS = 4 // AskUserQuestion asks 1 to 4 questions at once
const MAX_ANSWER = 2000 // a question's text, and an answer's
const FILE_ID = /^[A-Za-z0-9_-]{1,128}$/ // a patch's, a git diff's, a message's or an agent file's name: never a path
const CMD_ID = /^[A-Za-z0-9_-]{1,40}$/ // the page's id for a command, which the mod's ack names again
const CALL_ID = /^[A-Za-z0-9_-]{1,100}$/ // a tool call's tool_use_id
const TURN_ID = /^[A-Za-z0-9_-]{1,100}$/ // the main loop's running turn (abortTurn's)
const BG_ID = /^[A-Za-z0-9_-]{1,200}$/ // a background row's id (stopBackground's bgId): a task's or a schedule's, made web-safe
const STYLE = /^[a-z]{1,20}$/ // an avatar style's id (web/avatars.mjs STYLE_IDS); the mod says whether it knows it
const ROOT = /^[^\u0000-\u001f\u007f]{0,1000}$/ // a repository's root (selectRepo's): one line, '' to follow the work; the mod says whether Changes offers it
const SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/ // another session's id, as its registry file is named
// the commands that may name another session: every one about a session (hooks/sessions.ts STEERING); the avatar style is the person's, for every session
const STEERING = new Set(['chat', 'answer', 'stopAgent', 'abortTurn', 'stopBackground', 'clearFinished', 'showCleared', 'selectRepo', 'review'])
const SESSION_LIVE_MS = 3 * 60_000 // a registry file whose heartbeat is older is no live session's (hooks/sessions.ts STALE_MS)
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)$/i // Windows device names: never open them as files
const JSON_TYPE = 'application/json; charset=utf-8'
const TEXT_TYPE = 'text/plain; charset=utf-8'
const PAGE = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  // the page's own modules, which app.js imports (its head says what each holds)
  '/basics.mjs': ['basics.mjs', 'text/javascript; charset=utf-8'],
  '/state.mjs': ['state.mjs', 'text/javascript; charset=utf-8'],
  '/parts.mjs': ['parts.mjs', 'text/javascript; charset=utf-8'],
  '/now.mjs': ['now.mjs', 'text/javascript; charset=utf-8'],
  '/chat.mjs': ['chat.mjs', 'text/javascript; charset=utf-8'],
  '/org.mjs': ['org.mjs', 'text/javascript; charset=utf-8'],
  '/changes.mjs': ['changes.mjs', 'text/javascript; charset=utf-8'],
  '/inspect.mjs': ['inspect.mjs', 'text/javascript; charset=utf-8'],
  '/settings.mjs': ['settings.mjs', 'text/javascript; charset=utf-8'],
  // the avatar library the page imports (the mod draws the pane's avatars from it too)
  '/avatars.mjs': ['avatars.mjs', 'text/javascript; charset=utf-8'],
  // how Org's Timeline is laid out, which the page imports (the mod lays the pane's out with it too)
  '/timeline.mjs': ['timeline.mjs', 'text/javascript; charset=utf-8'],
}
// Scripts only from the page's own files, so agent text the page shows can never run as code; no other page may frame it.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
// On every answer: never cached, never sniffed, no Referer (the page's address may hold its ticket a moment), never framed, and nothing of it for another origin to load or keep a handle on.
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

// ---- the command line, and the secret (from stdin or the environment, never argv)
const log = message => process.stderr.write(`apiarius server: ${message}\n`)
const fail = message => { log(message); process.exit(2) }

const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  if (!['--dir', '--parent', '--port', '--sessions'].includes(key) || process.argv[i + 1] === undefined) fail('usage: node server.js --dir <dir> [--parent <pid>] [--port <port>] [--sessions <registry>]')
  args[key.slice(2)] = process.argv[i + 1]
}
if (!args.dir) fail('--dir is required')
const dir = path.resolve(args.dir)
// where the other sessions' folders are: beside this one's (`<home>/web`)
const webRoot = path.dirname(dir)
// the registry of every session on this machine; null: this session's own files alone
const sessions = args.sessions ? path.resolve(args.sessions) : null
const parent = args.parent === undefined ? null : Number(args.parent)
if (parent !== null && !(Number.isInteger(parent) && parent > 0)) fail('--parent must be a pid')
// A restart asks for its last port again, so the open page reconnects; when it is taken the OS picks one.
let wanted = args.port === undefined ? 0 : Number(args.port)
if (!(Number.isInteger(wanted) && wanted >= 0 && wanted < 65536)) fail('--port must be a port number')

let SECRET = null // the secret's bytes, once read: what each ticket is sealed with
const secretOk = secret => typeof secret === 'string' && secret.length >= 16 && !/[\u0000-\u0020\u007f]/.test(secret)

/** A ticket's seal: the first 32 hex digits of HMAC-SHA256(secret, "apiarius/ticket/1|<grade>|<nonce>"), "|<until>" after it for a ticket with a deadline, the grade spelled whole, as hooks/web.ts ticketOf makes it. */
const sealOf = (grade, nonce, until) => crypto.createHmac('sha256', SECRET).update(`apiarius/ticket/1|${grade}|${nonce}${until ? `|${until}` : ''}`).digest('hex').slice(0, 32)

/** A ticket's grade, nonce and deadline (ms since the epoch, 0 for none) when its seal is this secret's (compared in constant time); null for any other text. */
function ticketOf(value) {
  const found = SECRET !== null && typeof value === 'string' ? TICKET.exec(value) : null
  if (!found) return null
  const [, letter, nonce, until, seal] = found
  const grade = GRADES[letter]
  if (!crypto.timingSafeEqual(Buffer.from(sealOf(grade, nonce, until)), Buffer.from(seal))) return null
  return { grade, nonce, until: until ? parseInt(until, 16) * 1000 : 0 }
}

const used = new Set() // the nonces of the tickets traded: each opens one page
const handles = new Map() // handle → its grade, oldest first

/** A new handle of `grade` for a ticket just traded; the oldest let go past MAX_HANDLES. */
function newHandle(grade) {
  const handle = crypto.randomBytes(32).toString('base64url')
  handles.set(handle, grade)
  while (handles.size > MAX_HANDLES) handles.delete(handles.keys().next().value)
  return handle
}

/** The grade of a handle this server gave out (`pane` or `full`); null for any other value. */
const gradeOf = value => (typeof value === 'string' && HANDLE.test(value) ? handles.get(value) ?? null : null)

let port = 0

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
    try { text = readFileNoFollowSync(stateFile).trim() } catch { return false } // trim() drops a BOM too
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
    send(res, 200, body, type)
  })
}

function events(req, res) {
  // the page keeps one stream; a cap so a client that opens many never holds them all open at once
  if (clients.size >= MAX_CLIENTS) return send(res, 503, 'too many live connections\n')
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' })
  req.socket.setNoDelay(true)
  res.write(`retry: 1000\nevent: state\ndata: ${state}\n\n`)
  clients.add(res)
  req.on('close', () => clients.delete(res))
}

/**
 * A file the mod wrote beside the state, by id: `patches/<id>.diff` for
 * /patch/<id>, `gitdiffs/<diffId>.diff` (git's own diff of one uncommitted
 * file) for /gitdiff/<diffId>, `messages/<id>.md` (a cut message's whole
 * text) for /message/<id>, and `agents/<fileId>.json` (an agent's page
 * detail, written again when it changes) for /agent/<fileId>. Ids are
 * [A-Za-z0-9_-] only, so a request never names a path.
 */
function written(res, id, folder, ext, what, type = TEXT_TYPE) {
  if (!FILE_ID.test(id) || DEVICE.test(id)) return send(res, 400, `bad ${what} id\n`)
  readFileNoFollow(path.join(dir, folder, `${id}${ext}`), (err, text) => (err ? send(res, 404, `no such ${what}\n`) : send(res, 200, text, type)))
}

/** Why a file that opened is not read: anything but a regular file (a FIFO, a device, a folder), or one past MAX_FILE. */
function refusalOfStat(stat) {
  if (!stat.isFile()) return Object.assign(new Error('not a regular file'), { code: 'EINVAL' })
  return stat.size > MAX_FILE ? Object.assign(new Error('too big'), { code: 'EFBIG' }) : null
}

/**
 * Reads a file as UTF-8 without following a symbolic link at its final
 * component (a link planted in a session folder is refused, never read
 * through), and only as a regular file: it opens without blocking (a FIFO
 * there never holds a thread) and is read from what opened, once fstat says
 * so. The callback is handed the error otherwise.
 */
function readFileNoFollow(file, cb) {
  fs.open(file, fs.constants.O_RDONLY | NOFOLLOW | NONBLOCK, (err, fd) => {
    if (err) return cb(err)
    fs.fstat(fd, (statErr, stat) => {
      const refusal = statErr || refusalOfStat(stat)
      if (refusal) return fs.close(fd, () => cb(refusal))
      fs.readFile(fd, 'utf8', (readErr, text) => fs.close(fd, () => cb(readErr, text)))
    })
  })
}

/** `readFileNoFollow` at once (the state's reload, a registry file): its text, or it throws. */
function readFileNoFollowSync(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW | NONBLOCK)
  try {
    const refusal = refusalOfStat(fs.fstatSync(fd))
    if (refusal) throw refusal
    return fs.readFileSync(fd, 'utf8')
  } finally {
    fs.closeSync(fd)
  }
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Another session's state folder: only a live session's (its registry file
 * says its heartbeat is within 3 minutes and not ended), only the folder
 * `<home>/web/<its id>` beside this server's own (and still so once every
 * link is followed: a link there, or to it, is refused); null for any other.
 * A request names the session by its id alone, never a path. The registry
 * file carries no seal here, so the folder is derived from this server's own
 * web root and the id, never from a `dir` the file names: no field in it can
 * point the server at another folder.
 */
function sessionDirOf(id) {
  if (!sessions || !SESSION_ID.test(id) || DEVICE.test(id)) return null
  let entry
  try { entry = JSON.parse(readFileNoFollowSync(path.join(sessions, `${id}.json`))) } catch { return null }
  if (!isRecord(entry) || entry.id !== id || entry.endedAt !== undefined) return null
  if (!(typeof entry.heartbeatAt === 'number' && Date.now() - entry.heartbeatAt <= SESSION_LIVE_MS)) return null
  const shaped = path.join(webRoot, id)
  let real, realRoot
  try { real = fs.realpathSync(shaped); realRoot = fs.realpathSync(webRoot) } catch { return null }
  let stat
  try { stat = fs.lstatSync(shaped) } catch { return null }
  return real === path.join(realRoot, id) && stat.isDirectory() && !stat.isSymbolicLink() ? real : null
}

/** GET /s/<sessionId>/<what>: another session's state (`state`) or one of its lazy files, as this session's own are served; 404 for a session not listed. */
function otherSession(res, route) {
  const [, , id = '', what = '', file = '', extra] = route.split('/')
  const other = extra === undefined ? sessionDirOf(id) : null
  if (!other) return send(res, 404, 'no such session\n')
  if (what === 'state' && file === '') {
    return readFileNoFollow(path.join(other, 'state.json'), (err, text) => {
      if (err) return send(res, 200, EMPTY, JSON_TYPE)
      let value
      try { value = JSON.parse(text.trim()) } catch { return send(res, 503, 'state being written\n') }
      send(res, 200, JSON.stringify(value), JSON_TYPE)
    })
  }
  const lazy = { patch: ['patches', '.diff', 'patch', TEXT_TYPE], gitdiff: ['gitdiffs', '.diff', 'git diff', TEXT_TYPE], message: ['messages', '.md', 'message', TEXT_TYPE], agent: ['agents', '.json', 'agent file', JSON_TYPE] }[what]
  if (!lazy || !Object.prototype.hasOwnProperty.call({ patch: 1, gitdiff: 1, message: 1, agent: 1 }, what)) return send(res, 404, 'not found\n')
  const [folder, ext, word, type] = lazy
  if (!FILE_ID.test(file) || DEVICE.test(file)) return send(res, 400, `bad ${word} id\n`)
  readFileNoFollow(path.join(other, folder, `${file}${ext}`), (err, text) => (err ? send(res, 404, `no such ${word}\n`) : send(res, 200, text, type)))
}

/** An answer command's answers: 1 to 4 of question text → answer, each a string that is not blank and at most 2000 characters. */
function answersOf(value) {
  if (!isRecord(value)) return null
  const entries = Object.entries(value)
  const isText = text => typeof text === 'string' && text.trim() !== '' && text.length <= MAX_ANSWER
  if (entries.length < 1 || entries.length > MAX_ANSWERS || !entries.every(([question, answer]) => isText(question) && isText(answer))) return null
  return Object.fromEntries(entries) // own keys only, even one named __proto__
}

/**
 * The command a body holds, rebuilt from exactly its known keys; null for any
 * other shape. Every command may carry the page's `id`, which the mod's ack
 * names again; it stays optional. `stopAgent` names its agent; `abortTurn`
 * may name the running turn it means; `stopBackground` names a background
 * row (`bgId`); `avatarStyle` names a style; `selectRepo` names the root
 * Changes is to show ('' to follow the work again);
 * `clearFinished` and `showCleared` (the deck's own tidying) name nothing.
 */
function commandOf(value) {
  if (!isRecord(value)) return null
  // for another session (the page views its deck): `view` names it alone; any command about a session (STEERING) is checked as this session's, then carries it
  if (Object.prototype.hasOwnProperty.call(value, 'session')) {
    if (!(sessions && typeof value.session === 'string' && SESSION_ID.test(value.session))) return null
    const { session, ...rest } = value
    if (rest.cmd === 'view') {
      const hasId = Object.prototype.hasOwnProperty.call(rest, 'id')
      if (hasId && !(typeof rest.id === 'string' && CMD_ID.test(rest.id))) return null
      return Object.keys(rest).filter(key => key !== 'id').join(',') === 'cmd' ? { cmd: 'view', ...(hasId ? { id: rest.id } : {}), session } : null
    }
    if (!STEERING.has(rest.cmd)) return null
    const inner = commandOf(rest)
    return inner ? { ...inner, session } : null
  }
  const hasId = Object.prototype.hasOwnProperty.call(value, 'id')
  if (hasId && !(typeof value.id === 'string' && CMD_ID.test(value.id))) return null
  const id = hasId ? { id: value.id } : {}
  const keys = Object.keys(value).filter(key => key !== 'id').sort().join(',')
  const isText = text => typeof text === 'string' && text.trim() !== '' && text.length <= MAX_TEXT
  const isAgent = agent => typeof agent === 'string' && /^[^\u0000-\u001f\u007f]{1,200}$/.test(agent)
  if (value.cmd === 'ping' && keys === 'cmd') return { cmd: 'ping', ...id }
  if (value.cmd === 'review' && keys === 'cmd,text' && isText(value.text)) return { cmd: 'review', ...id, text: value.text }
  if (value.cmd === 'chat' && keys === 'agentId,cmd,text' && isAgent(value.agentId) && isText(value.text)) return { cmd: 'chat', ...id, agentId: value.agentId, text: value.text }
  if (value.cmd === 'stopAgent' && keys === 'agentId,cmd' && isAgent(value.agentId)) return { cmd: 'stopAgent', ...id, agentId: value.agentId }
  if (value.cmd === 'abortTurn' && keys === 'cmd') return { cmd: 'abortTurn', ...id }
  if (value.cmd === 'abortTurn' && keys === 'cmd,turnId' && typeof value.turnId === 'string' && TURN_ID.test(value.turnId)) return { cmd: 'abortTurn', ...id, turnId: value.turnId }
  if (value.cmd === 'stopBackground' && keys === 'bgId,cmd' && typeof value.bgId === 'string' && BG_ID.test(value.bgId)) return { cmd: 'stopBackground', ...id, bgId: value.bgId }
  if (value.cmd === 'avatarStyle' && keys === 'cmd,style' && typeof value.style === 'string' && STYLE.test(value.style)) return { cmd: 'avatarStyle', ...id, style: value.style }
  if (value.cmd === 'selectRepo' && keys === 'cmd,root' && typeof value.root === 'string' && ROOT.test(value.root)) return { cmd: 'selectRepo', ...id, root: value.root }
  if (value.cmd === 'clearFinished' && keys === 'cmd') return { cmd: 'clearFinished', ...id }
  if (value.cmd === 'showCleared' && keys === 'cmd') return { cmd: 'showCleared', ...id }
  if (value.cmd === 'answer' && keys === 'answers,callId,cmd' && typeof value.callId === 'string' && CALL_ID.test(value.callId)) {
    const answers = answersOf(value.answers)
    if (answers) return { cmd: 'answer', ...id, callId: value.callId, answers }
  }
  return null
}

/** POST /cmd: only the page itself may send one (a handle in its header, which no other site can set, and its own Origin); printed with the handle's grade. */
function command(req, res, host) {
  const grade = gradeOf(req.headers['x-deck-handle'])
  if (grade === null || (req.headers.origin ?? '').toLowerCase() !== `http://${host}`) {
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
    process.stdout.write(`${JSON.stringify({ ...cmd, grade })}\n`) // one line: JSON.stringify escapes every newline
    send(res, 200, '{"ok":true}', JSON_TYPE)
  })
}

/**
 * POST /session: the page trades its link's ticket (the `X-Deck-Ticket`
 * header, from its own Origin) for a handle of the ticket's grade, once: a
 * ticket used before is refused (`used`), as is one this secret never
 * sealed (`unknown`: an earlier server's, or none), and one past its
 * deadline (`expired`). The mod hears of each use, so a link it shows that
 * was used is made anew.
 */
function session(req, res, host) {
  req.resume() // a body says nothing here
  if ((req.headers.origin ?? '').toLowerCase() !== `http://${host}`) return send(res, 403, '{"ok":false,"error":"forbidden"}', JSON_TYPE)
  const ticket = ticketOf(req.headers['x-deck-ticket'])
  if (ticket === null) return send(res, 403, '{"ok":false,"error":"unknown"}', JSON_TYPE)
  if (used.has(ticket.nonce) || used.size >= MAX_USED) return send(res, 403, '{"ok":false,"error":"used"}', JSON_TYPE)
  if (ticket.until !== 0 && Date.now() > ticket.until) return send(res, 403, '{"ok":false,"error":"expired"}', JSON_TYPE)
  used.add(ticket.nonce)
  const handle = newHandle(ticket.grade)
  process.stdout.write(`${JSON.stringify({ used: ticket.nonce, grade: ticket.grade })}\n`)
  send(res, 200, JSON.stringify({ ok: true, handle, grade: ticket.grade }), JSON_TYPE)
}

function handle(req, res) {
  for (const [name, value] of Object.entries(HEADERS)) res.setHeader(name, value)
  // A site that points its own name at 127.0.0.1 (DNS rebinding) still sends that name as the Host.
  const host = (req.headers.host ?? '').toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 421, 'misdirected request\n')
  const url = new URL(`http://deck${req.url.startsWith('/') ? req.url : `/${req.url}`}`) // '//x' stays a path, never a host
  const route = url.pathname
  if (route === '/cmd' && req.method === 'POST') return command(req, res, host)
  if (route === '/session' && req.method === 'POST') return session(req, res, host)
  // The page's own files hold no data: served to any page on this host and port, the ticket left to the page (state.mjs reads `t` from the address and trades it).
  if (req.method === 'GET' && PAGE[route]) return page(res, PAGE[route])
  if (req.method === 'GET' && route === '/favicon.ico') return res.writeHead(204).end()

  // Everything else needs a handle: the header, or `h` for /events alone, which an EventSource opens with no header.
  if (gradeOf(req.headers['x-deck-handle']) === null && !(route === '/events' && gradeOf(url.searchParams.get('h')) !== null)) return send(res, 403, 'forbidden\n')

  if (req.method !== 'GET' || route === '/cmd' || route === '/session') {
    res.setHeader('Allow', route === '/cmd' || route === '/session' ? 'POST' : 'GET')
    return send(res, 405, 'method not allowed\n')
  }
  if (route === '/state') return send(res, 200, state, JSON_TYPE)
  if (route === '/events') return events(req, res)
  if (route.startsWith('/patch/')) return written(res, route.slice('/patch/'.length), 'patches', '.diff', 'patch')
  if (route.startsWith('/gitdiff/')) return written(res, route.slice('/gitdiff/'.length), 'gitdiffs', '.diff', 'git diff')
  if (route.startsWith('/message/')) return written(res, route.slice('/message/'.length), 'messages', '.md', 'message')
  if (route.startsWith('/agent/')) return written(res, route.slice('/agent/'.length), 'agents', '.json', 'agent file', JSON_TYPE)
  if (route.startsWith('/s/')) return otherSession(res, route)
  if (route === '/timeline') return written(res, 'timeline', '.', '.json', 'timeline', JSON_TYPE) // Org's Timeline, timeline.json beside the state
  send(res, 404, 'not found\n')
}

const server = http.createServer((req, res) => {
  try { handle(req, res) } catch (err) {
    log(err?.stack ?? err)
    if (!res.headersSent) send(res, 500, 'server error\n')
  }
})
// a slow client never holds a connection open for long: time to receive the headers, then the whole request (the long-lived /events stream is sent once the request is in, so neither cuts it)
server.headersTimeout = 10_000
server.requestTimeout = 20_000

// ---- lifetime: leave with the session. Windows does not kill a child with
// its parent, so watch the parent's pid; stdin closing is the faster signal.
const quit = () => process.exit(0)

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' } // EPERM: alive, just not ours
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK']) process.on(signal, quit)
process.stdout.on('error', quit) // EPIPE: nobody reads the commands any more
// When the secret comes on stdin (the mod's `input`), stdin ends right after
// it, so that end says nothing. Otherwise, only a pipe that closes later means
// the parent let go: stdin 'ignore' (the null device) or a pipe closed from
// the start ends at once, and a terminal belongs to a user, so those cases
// are left to the pid check.
const fromEnv = process.env.APIARIUS_SECRET ?? ''
if (fromEnv === '') {
  readSecret()
} else if (process.stdin instanceof net.Socket && !process.stdin.isTTY) {
  const ended = () => { if (process.uptime() > 1) quit() }
  process.stdin.on('end', ended).on('close', ended).on('error', ended).resume()
}
if (parent !== null) {
  if (!isAlive(parent)) quit()
  setInterval(() => { if (!isAlive(parent)) quit() }, 2000)
}

server.on('listening', () => {
  port = server.address().port
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

/** Takes the secret (16 characters or more, one line, nothing blank in it) and starts listening; a bad one exits. */
function begin(secret) {
  if (!secretOk(secret)) fail('the secret must come on stdin or as APIARIUS_SECRET: 16 characters or more, on one line')
  SECRET = Buffer.from(secret, 'utf8')
  server.listen(wanted, '127.0.0.1')
}

/** The secret as stdin's first line, or all of it once it ends; none within 10 s exits. */
function readSecret() {
  let text = ''
  let isTaken = false
  const take = line => {
    if (isTaken) return
    isTaken = true
    clearTimeout(timer)
    begin(line.replace(/\r$/, ''))
  }
  const timer = setTimeout(() => fail('no secret on stdin'), 10_000)
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    if (isTaken) return
    text += chunk
    const at = text.indexOf('\n')
    if (at >= 0) take(text.slice(0, at))
    else if (text.length > 1000) fail('no secret on stdin')
  })
  process.stdin.on('end', () => take(text)).on('error', () => take(text)).resume()
}

if (fromEnv !== '') begin(fromEnv)
