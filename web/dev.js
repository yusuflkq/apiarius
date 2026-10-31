/**
 * The web deck on the v2 sample: `node web/dev.js` runs the server with a
 * fixed dev token and prints the URL to open.
 *
 * It serves a copy of the sample (web/fixtures/state.v2.json, with its lazy
 * files under web/fixtures/v2/) in a temp home laid out as Apiarius's home
 * is (`<home>/web/<sessionId>`, hooks/web.ts webDirOf): state.json holds the
 * sample under `v2` as the mod writes it, beside agents/, patches/, messages/
 * and gitdiffs/. Its times move to now,
 * so ages read as they would live. It plays the mod's part for the page's
 * commands: each gets its ack, a chat shows in the stream and its agent
 * answers a moment later, an answer resolves its question, Stop (stopAgent,
 * stopBackground) and Stop turn (abortTurn) stop what they name where the
 * sample's `stop.can` allows it, saying so in the chat, and Clear finished
 * hides the finished agents until Show N cleared. Commands are printed here
 * too.
 * Every session on the sample's machine (All sessions) comes along: the
 * sample's registry (web/fixtures/sessions.v2.json) in a registry folder the
 * server reads (`--sessions`), the other sessions' decks in `web/<id>/`
 * beside this one's, and the list in the state; a command to one of them (an
 * answer, a message, Stop, Stop turn, Cancel, Clear finished, a pick,
 * Review) plays on its own state and is acked there, as its deck would, or
 * refused where its deck reads no inbox.
 * Editing the sample starts the copy again from it. `--static` keeps the
 * sample's own times and only prints commands. `--fixtures <dir>` serves
 * another sample laid out as web/fixtures is (state.v2.json, v2/, and
 * sessions.v2.json with the sessions' folders it names, if any). Ctrl+C
 * stops both processes.
 */
'use strict'
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TOKEN = 'apiarius-dev-token'
const USAGE = 'usage: node web/dev.js [--static] [--fixtures <dir>]'
/** The sample's folder: web/fixtures, or the one `--fixtures` names. */
const FIXTURES = (() => {
  const at = process.argv.indexOf('--fixtures')
  if (at < 0) return path.join(__dirname, 'fixtures')
  const named = process.argv[at + 1]
  if (!named || named.startsWith('--')) { console.error(USAGE); process.exit(2) }
  const folder = path.resolve(named)
  if (!fs.existsSync(path.join(folder, 'state.v2.json'))) { console.error(`dev: no state.v2.json in ${folder}`); process.exit(2) }
  return folder
})()
const SAMPLE = path.join(FIXTURES, 'state.v2.json')
const LAZY = path.join(FIXTURES, 'v2')
const isStatic = process.argv.includes('--static')
const SESSIONS = path.join(FIXTURES, 'sessions.v2.json')
/** The temp home, and this session's folder in it as the mod makes one: `<home>/web/<the sample's own id>`. */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'apiarius-dev-'))
const ME = (() => { try { return String(JSON.parse(fs.readFileSync(SESSIONS, 'utf8')).me || 'dev-session') } catch { return 'dev-session' } })()
const dir = path.join(home, 'web', /^[A-Za-z0-9_-]{1,100}$/.test(ME) ? ME : 'dev-session')
fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
const stateFile = path.join(dir, 'state.json')
let state = null // the v2 state

// ---- the copy: the sample, every time moved by the same amount so the state's `now` is now (hooks/web.ts v2TimesMoved)
const TIMES = new Set(['at', 'now', 'startedAt', 'endedAt', 'lastAt', 'nextAt'])
function shift(value, by) {
  if (Array.isArray(value)) { for (const one of value) if (one && typeof one === 'object') shift(one, by) }
  else for (const [key, one] of Object.entries(value)) {
    if (one && typeof one === 'object') shift(one, by)
    else if (TIMES.has(key) && typeof one === 'number' && one > 1e12) value[key] = one + by
  }
  return value
}

/** One of the session folder's lazy folders, afresh from the sample's; the agent files' times moved with the state's. */
function copyFolder(name, by) {
  const from = path.join(LAZY, name), to = path.join(dir, name)
  fs.rmSync(to, { recursive: true, force: true })
  fs.mkdirSync(to, { recursive: true })
  if (!fs.existsSync(from)) return
  for (const file of fs.readdirSync(from)) {
    if (name === 'agents' && by) fs.writeFileSync(path.join(to, file), `${JSON.stringify(shift(JSON.parse(fs.readFileSync(path.join(from, file), 'utf8')), by), null, 2)}\n`)
    else fs.copyFileSync(path.join(from, file), path.join(to, file))
  }
}

function reset() {
  let sample
  try { sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8')) } catch { return } // half-saved: the next change resets
  const by = isStatic ? 0 : Date.now() - sample.now
  try { for (const name of ['agents', 'patches', 'messages', 'gitdiffs']) copyFolder(name, by) } catch (err) { console.error(`dev: ${err.message}`); return }
  // Org's Timeline: its times count from its startedAt, so moving that (and its now) moves it all
  try { fs.writeFileSync(path.join(dir, 'timeline.json'), `${JSON.stringify(shift(JSON.parse(fs.readFileSync(path.join(LAZY, 'timeline.json'), 'utf8')), by))}\n`) } catch { fs.rmSync(path.join(dir, 'timeline.json'), { force: true }) }
  // a fresh state: what Clear finished kept of the last one (`stashes`) goes with it
  state = by ? shift(sample, by) : sample
  resetSessions()
  save()
}

// ---- every session on the sample's machine: the registry the server reads, and the other sessions' decks beside this one's
const registry = path.join(home, 'sessions')
/** The sample's registry (each file's `dir` the copy's), the list as this deck shows it, and the other sessions' states; null when the sample has none. */
let others = null

function resetSessions() {
  let sample
  try { sample = JSON.parse(fs.readFileSync(SESSIONS, 'utf8')) } catch { others = null; return }
  const by = isStatic ? 0 : Date.now() - sample.now
  fs.rmSync(registry, { recursive: true, force: true })
  fs.mkdirSync(registry, { recursive: true })
  const states = new Map()
  const entries = sample.entries.map(entry => {
    if (entry.id === sample.me || !entry.dir) return entry
    // a session's folder as the mod makes one: <home>/web/<its id>, beside this one's
    const from = path.join(FIXTURES, entry.dir), to = path.join(home, 'web', entry.id)
    fs.rmSync(to, { recursive: true, force: true })
    fs.mkdirSync(path.join(to, 'agents'), { recursive: true })
    states.set(entry.id, shift(JSON.parse(fs.readFileSync(path.join(from, 'state.json'), 'utf8')), by))
    for (const file of fs.readdirSync(path.join(from, 'agents'))) fs.writeFileSync(path.join(to, 'agents', file), JSON.stringify(shift(JSON.parse(fs.readFileSync(path.join(from, 'agents', file), 'utf8')), by)))
    return { ...entry, dir: to }
  })
  others = { me: sample.me, entries, view: shift(sample.view, by), states }
  saveOthers()
}

/** The registry's files (each heartbeat now, as their decks' are) and the other sessions' states. */
function saveOthers() {
  if (!others) return
  for (const entry of others.entries) if (entry.id !== others.me && entry.dir) fs.writeFileSync(path.join(registry, `${entry.id}.json`), JSON.stringify({ ...entry, heartbeatAt: Date.now() }))
  for (const [id, one] of others.states) fs.writeFileSync(path.join(home, 'web', id, 'state.json'), JSON.stringify(one))
}
setInterval(saveOthers, 60000).unref()

/** A command for another session's deck: played on its own state as this deck's are (an answer, a message, Stop, Stop turn, Cancel, Clear finished, a pick, Review), its ack there, as its deck would; refused where its deck reads no inbox. */
function playOther(cmd) {
  if (cmd.cmd === 'view' || !others) return
  const entry = others.entries.find(one => one.id === cmd.session)
  const theirs = others.states.get(cmd.session)
  if (!entry || !theirs || !entry.inbox) return later(300, () => ack(cmd.id, false, 'failed', "Its deck isn't answering: it runs an older Apiarius"))
  const { session: _session, ...own } = cmd
  // a beat for its deck to read its inbox, as a tick would
  target = theirs
  try { later(500, () => play(own)) } finally { target = null }
}

function save() {
  if (!isStatic) state.now = Math.max(Date.now(), (state.now || 0) + 1) // never older: the page drops an older write of the same session
  // as the mod writes it: v1's keys first (here only the few every state has), the v2 state under `v2`
  const file = { v: 1, now: state.now, session: { ...state.session, model: state.header.model }, v2: others ? { ...state, sessions: others.view } : state }
  fs.writeFileSync(stateFile, `${JSON.stringify(file, null, 1)}\n`)
}

// ---- the mod's part, roughly: acks, the chat, the questions, Clear finished
let seq = 0
/** The rows as they stood before Clear finished, for Show N cleared: each session's state its own. */
const stashes = new WeakMap()
/** The other session's state a command plays on (`playOther`); null: this one's. */
let target = null
/** `fn` in `ms`, on the state it was given for (this one's, or another session's, `target`), which is written after it. */
const later = (ms, fn) => {
  const on = target
  setTimeout(() => {
    if (!state) return
    if (!on) { fn(); save(); return }
    const kept = state
    state = on
    target = on
    try { fn() } finally { state = kept; target = null }
    on.now = Date.now()
    saveOthers()
  }, ms)
}
const rows = () => state.agents.filter(r => r.row === 'agent')
const rowOf = id => rows().find(r => r.id === id)
const firstLine = text => { const line = String(text).split('\n').find(l => l.trim()) || ''; return line.length > 80 ? `${line.slice(0, 79)}…` : line }
const say = (from, to, who, kind, text, extra = {}) => {
  const at = Date.now()
  state.chat.push({ id: `m${at}_dev${++seq}`, at, from, to, who, kind, text, ...extra })
  state.chat = state.chat.slice(-200)
}
/** An ack; a later word on the same id replaces the earlier one in place. */
const ack = (id, ok, status, text) => {
  if (!id) return
  const one = { id, ok, status, text, at: Date.now() }
  const at = state.acks.findIndex(k => k.id === id)
  if (at >= 0) state.acks[at] = one
  else state.acks = [...state.acks, one].slice(-50)
}
/** The header and the rows' need counts, after the needs changed. */
function settle() {
  for (const r of rows()) r.needs = state.needs.filter(n => n.agent === r.id).length
  const working = rows().some(r => r.status === 'running' || r.status === 'starting')
  state.header.state = state.needs.length ? 'waiting' : working ? 'working' : 'idle'
  state.header.stateText = { working: 'Working', waiting: 'Waiting on you', idle: 'Idle' }[state.header.state]
}

function play(cmd) {
  if (cmd.session) return playOther(cmd)
  if (cmd.cmd === 'chat') {
    later(400, () => {
      const a = rowOf(cmd.agentId)
      if (!a) return ack(cmd.id, false, 'failed', 'No such agent in this session')
      say('you', a.id, `You → ${a.title}`, 'chat', cmd.text, cmd.id ? { ackId: cmd.id } : {})
      if (a.id === 'main') {
        ack(cmd.id, true, 'queued', 'Claude reads it when it finishes its current turn')
        state.header.goal = { text: cmd.text, headline: firstLine(cmd.text), at: Date.now() }
        later(2500, () => say('main', 'you', `${a.title} → you`, 'answer', '**Noted.** I will take that in once this turn ends.\n\n(The dev deck made this reply up.)'))
      } else {
        ack(cmd.id, true, 'delivered', 'It reads it at its next step')
        later(2500, () => say(a.id, null, a.title, 'chat', 'Got it: I will work that in at my next step. (The dev deck made this reply up.)'))
      }
    })
  } else if (cmd.cmd === 'answer') {
    later(500, () => {
      const n = state.needs.find(one => one.id === cmd.callId)
      if (!n || n.kind !== 'question') return ack(cmd.id, false, 'failed', 'No longer pending')
      state.needs = state.needs.filter(one => one !== n)
      const words = n.questions.map(q => cmd.answers[q.question]).filter(Boolean).join('; ')
      say('you', n.agent, `You → ${n.agentName}`, 'choice', `You answered: ${words}`, { callId: n.id, ...(cmd.id ? { ackId: cmd.id } : {}) })
      ack(cmd.id, true, 'answered', 'Claude carries on')
      const a = rowOf(n.agent)
      if (a && !state.needs.some(one => one.agent === a.id)) Object.assign(a, { status: 'running', live: null })
      settle()
    })
  } else if (cmd.cmd === 'review') {
    // as on Desktop: the review goes to the Orchestrator as your next prompt, logged like a chat
    later(500, () => {
      say('you', 'main', 'You → Orchestrator', 'chat', cmd.text, cmd.id ? { ackId: cmd.id } : {})
      ack(cmd.id, true, 'queued', 'Claude reviews it when it finishes its current turn')
    })
  } else if (cmd.cmd === 'stopAgent') {
    // as the mod: only where Claude Code's check allowed TaskStop (the row's stop.can); the agent stopped, Chat says so
    later(400, () => {
      const a = rowOf(cmd.agentId)
      if (!a || !a.stop) return ack(cmd.id, false, 'failed', 'It is not at work')
      if (!a.stop.can) return ack(cmd.id, false, 'failed', a.stop.why)
      Object.assign(a, { status: 'failed', isStopped: true, live: null, endedAt: Date.now(), needs: 0 })
      delete a.stop
      state.needs = state.needs.filter(n => n.agent !== a.id)
      settle()
      say('you', a.id, `You → ${a.title}`, 'stop', `You stopped ${a.title}`, cmd.id ? { ackId: cmd.id } : {})
      ack(cmd.id, true, 'delivered', `Stopped ${a.title}`)
    })
  } else if (cmd.cmd === 'abortTurn') {
    later(300, () => {
      if (!state.header.turn || (cmd.turnId && cmd.turnId !== state.header.turn.id)) return ack(cmd.id, false, 'failed', state.header.turn ? 'That turn has ended' : 'No turn is running')
      state.header.turn = null
      const main = rowOf('main')
      if (main) { delete main.stop; main.live = null }
      say('you', 'main', 'You → Orchestrator', 'stop', 'You stopped the turn', cmd.id ? { ackId: cmd.id } : {})
      ack(cmd.id, true, 'delivered', 'Stopped the turn')
    })
  } else if (cmd.cmd === 'stopBackground') {
    later(400, () => {
      const bg = state.background
      const x = bg && bg.rows.find(one => one.id === cmd.bgId)
      if (!x || !x.stop) return ack(cmd.id, false, 'failed', 'Nothing runs in the background by that name: it may have ended')
      if (!x.stop.can) return ack(cmd.id, false, 'failed', x.stop.why)
      bg.rows = bg.rows.filter(one => one !== x)
      if (x.status === 'scheduled') bg.scheduled -= 1
      else bg.tasks -= 1
      // its line of counts, worded as the mod words it (hooks/background.ts backgroundOf)
      const words = [['shell', 'shell', 'shells'], ['monitor', 'monitor', 'monitors'], ['workflow', 'workflow', 'workflows'], ['agent', 'agent', 'agents'], ['other', 'task', 'tasks']]
      const counts = words.flatMap(([kind, one, many]) => { const n = bg.rows.filter(r => r.kind === kind && r.status !== 'scheduled').length; return n ? [`${n} ${n === 1 ? one : many}`] : [] })
      if (bg.scheduled) counts.push(`${bg.scheduled} scheduled`)
      bg.text = counts.join(' · ')
      const verb = x.stop.tool === 'CronDelete' ? 'cancelled' : 'stopped'
      say('you', null, 'You', 'stop', `You ${verb} ${x.title}`, { ...(x.by ? { agent: x.by } : {}), ...(cmd.id ? { ackId: cmd.id } : {}) })
      ack(cmd.id, true, 'delivered', `${verb[0].toUpperCase()}${verb.slice(1)} ${x.title}`)
    })
  } else if (cmd.cmd === 'clearFinished') {
    // as the mod, roughly (W.clearedStateOf): every finished agent hidden from the deck, their messages from Everyone, their fold rows gone
    later(200, () => {
      const isDone = r => r.kind !== 'orchestrator' && !r.needs && !r.isCleared && (r.status === 'done' || r.status === 'failed' || r.status === 'idle')
      const ids = rows().filter(isDone).map(r => r.id)
      if (!ids.length) return ack(cmd.id, false, 'failed', 'Nothing finished to clear')
      if (!stashes.has(state)) stashes.set(state, state.agents.map(r => ({ ...r })))
      for (const r of rows()) if (ids.includes(r.id)) r.isCleared = true
      const gone = new Set(rows().filter(r => r.isCleared).map(r => r.id))
      state.agents = state.agents.filter(r => r.row !== 'fold' || r.ids.some(id => !gone.has(id)))
      for (const m of state.chat) if (gone.has(m.from) || gone.has(m.to) || gone.has(m.agent)) m.isCleared = true
      state.cleared = { count: gone.size, at: Date.now() }
      ack(cmd.id, true, 'delivered', `Cleared ${ids.length} finished ${ids.length === 1 ? 'agent' : 'agents'} from the deck`)
    })
  } else if (cmd.cmd === 'showCleared') {
    later(200, () => {
      const n = state.cleared ? state.cleared.count : 0
      const stash = stashes.get(state)
      if (!n || !stash) return ack(cmd.id, false, 'failed', 'Nothing cleared to show')
      const current = new Map(rows().map(r => [r.id, r]))
      state.agents = stash.map(r => { const one = { ...(r.row === 'agent' ? current.get(r.id) || r : r) }; delete one.isCleared; return one })
      stashes.delete(state)
      for (const m of state.chat) delete m.isCleared
      state.cleared = { count: 0, at: null }
      ack(cmd.id, true, 'delivered', `Showing ${n} cleared ${n === 1 ? 'agent' : 'agents'} again`)
    })
  } else if (cmd.cmd === 'selectRepo') {
    // as the mod: a pick Changes offers pinned, '' following the work again (the sample's repository stays the one shown)
    later(200, () => {
      const where = state.changes.where
      const pick = where && where.picks.find(one => one.root === cmd.root)
      if (cmd.root && !pick) return ack(cmd.id, false, 'failed', 'Not a repository Changes offers here')
      if (where) where.pinned = pick ? pick.root : ''
      ack(cmd.id, true, 'delivered', pick ? `Changes shows ${pick.name}` : 'Changes follows the work again')
    })
  } else if (cmd.cmd === 'avatarStyle') {
    // as the mod: the style is the person's own, and the next state names it (the dev deck keeps it while it runs)
    later(200, () => {
      state.avatarStyle = cmd.style
      ack(cmd.id, true, 'delivered', `Avatars: ${cmd.style}`)
    })
  }
}

// ---- the server
const args = [path.join(__dirname, 'server.js'), '--dir', dir, '--parent', String(process.pid), '--sessions', registry]
reset()
// stdin stays a pipe: the server leaves when it closes, so it goes when this process does
const server = spawn(process.execPath, args, { env: { ...process.env, APIARIUS_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'inherit'] })

let buffer = ''
server.stdout.setEncoding('utf8').on('data', chunk => {
  buffer += chunk
  let at
  while ((at = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    const ready = /^\{"ready":(\d+)\}$/.exec(line)
    if (ready) { console.log(`Apiarius (dev${isStatic ? ', static' : ''}): http://127.0.0.1:${ready[1]}/?t=${TOKEN}`); continue }
    console.log(`command: ${line}`)
    if (!isStatic) { try { play(JSON.parse(line)) } catch (err) { console.error(`dev: ${err.message}`) } }
  }
})

let timer = null
fs.watch(FIXTURES, (_, name) => { if (name === 'state.v2.json') { clearTimeout(timer); timer = setTimeout(reset, 150) } })

const tidy = () => { try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* in use: the OS clears its temp */ } }
server.on('exit', code => { tidy(); process.exit(code ?? 0) })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => { server.kill(); tidy(); process.exit(0) })
