/**
 * The web deck on the v2 sample: `node web/dev.js` runs the server with a
 * fixed dev token and prints the URL to open.
 *
 * It serves a copy of the sample (web/fixtures/state.v2.json, with its lazy
 * files under web/fixtures/v2/) in a temp folder laid out as a session's
 * folder is: state.json holds the sample under `v2` as the mod writes it,
 * beside agents/, patches/, messages/ and gitdiffs/. Its times move to now,
 * so ages read as they would live. It plays the mod's part for the page's
 * commands: each gets its ack, a chat shows in the stream and its agent
 * answers a moment later, an answer resolves its question, and stopAgent and
 * abortTurn get this build's "Not in this build yet". Commands are printed
 * here too.
 * Editing the sample starts the copy again from it. `--static` keeps the
 * sample's own times and only prints commands. Ctrl+C stops both processes.
 */
'use strict'
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TOKEN = 'agent-deck-dev-token'
const FIXTURES = path.join(__dirname, 'fixtures')
const SAMPLE = path.join(FIXTURES, 'state.v2.json')
const LAZY = path.join(FIXTURES, 'v2')
const isStatic = process.argv.includes('--static')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-deck-dev-'))
const stateFile = path.join(dir, 'state.json')
let state = null // the v2 state

// ---- the copy: the sample, every time moved by the same amount so the state's `now` is now (hooks/web.ts v2TimesMoved)
const TIMES = new Set(['at', 'now', 'startedAt', 'endedAt'])
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
  state = by ? shift(sample, by) : sample
  save()
}

function save() {
  if (!isStatic) state.now = Math.max(Date.now(), (state.now || 0) + 1) // never older: the page drops an older write of the same session
  // as the mod writes it: v1's keys first (here only the few every state has), the v2 state under `v2`
  const file = { v: 1, now: state.now, session: { ...state.session, model: state.header.model }, v2: state }
  fs.writeFileSync(stateFile, `${JSON.stringify(file, null, 1)}\n`)
}

// ---- the mod's part, roughly: acks, the chat, the questions
let seq = 0
const later = (ms, fn) => setTimeout(() => { if (state) { fn(); save() } }, ms)
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
    later(300, () => ack(cmd.id, false, 'failed', 'Not in this build yet: stop it in Claude Code'))
  } else if (cmd.cmd === 'abortTurn') {
    later(300, () => ack(cmd.id, false, 'failed', 'Not in this build yet: press Esc in Claude Code'))
  }
}

// ---- the server
const args = [path.join(__dirname, 'server.js'), '--dir', dir, '--parent', String(process.pid)]
reset()
// stdin stays a pipe: the server leaves when it closes, so it goes when this process does
const server = spawn(process.execPath, args, { env: { ...process.env, AGENT_DECK_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'inherit'] })

let buffer = ''
server.stdout.setEncoding('utf8').on('data', chunk => {
  buffer += chunk
  let at
  while ((at = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    const ready = /^\{"ready":(\d+)\}$/.exec(line)
    if (ready) { console.log(`Agent Deck (dev${isStatic ? ', static' : ''}): http://127.0.0.1:${ready[1]}/?t=${TOKEN}`); continue }
    console.log(`command: ${line}`)
    if (!isStatic) { try { play(JSON.parse(line)) } catch (err) { console.error(`dev: ${err.message}`) } }
  }
})

let timer = null
fs.watch(FIXTURES, (_, name) => { if (name === 'state.v2.json') { clearTimeout(timer); timer = setTimeout(reset, 150) } })

const tidy = () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* in use: the OS clears its temp */ } }
server.on('exit', code => { tidy(); process.exit(code ?? 0) })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => { server.kill(); tidy(); process.exit(0) })
