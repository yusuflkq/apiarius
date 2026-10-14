/**
 * The web deck on the sample state: `node web/dev.js` runs the server with a
 * fixed dev token and prints the URL to open.
 *
 * It serves a copy of web/fixtures in a temp folder, its times moved to now
 * so ages read as they would live, and plays the mod's part for the page's
 * commands: each gets its ack, a chat shows in the thread and the agent
 * answers a moment later, an answer resolves its question. Commands are
 * printed here too. Editing web/fixtures/state.json starts the copy again
 * from it. `--static` serves web/fixtures as it is and only prints commands.
 * Ctrl+C stops both processes.
 */
'use strict'
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TOKEN = 'agent-deck-dev-token'
const FIXTURES = path.join(__dirname, 'fixtures')
const isStatic = process.argv.includes('--static')
const dir = isStatic ? FIXTURES : fs.mkdtempSync(path.join(os.tmpdir(), 'agent-deck-dev-'))
const stateFile = path.join(dir, 'state.json')
let state = null

// ---- the copy: the fixtures, every time moved by the same amount so the state's `now` is now
const TIMES = new Set(['at', 'now', 'startedAt', 'endedAt', 'lastAt'])
function shift(value, by) {
  if (Array.isArray(value)) { for (const one of value) if (one && typeof one === 'object') shift(one, by) }
  else for (const [key, one] of Object.entries(value)) {
    if (one && typeof one === 'object') shift(one, by)
    else if (TIMES.has(key) && typeof one === 'number' && one > 1e12) value[key] = one + by
  }
  return value
}

function copyFolder(name) {
  const from = path.join(FIXTURES, name), to = path.join(dir, name)
  fs.mkdirSync(to, { recursive: true })
  if (fs.existsSync(from)) for (const file of fs.readdirSync(from)) fs.copyFileSync(path.join(from, file), path.join(to, file))
}

function reset() {
  let fixture
  try { fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'state.json'), 'utf8')) } catch { return } // half-saved: the next change resets
  copyFolder('patches')
  copyFolder('messages')
  state = shift(fixture, Date.now() - fixture.now)
  save()
}

function save() {
  state.now = Math.max(Date.now(), (state.now || 0) + 1) // never older: the page drops an older write of the same session
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 1)}\n`)
}

// ---- the mod's part, roughly: acks, the thread, the questions
let seq = 0
const later = (ms, fn) => setTimeout(() => { if (state) { fn(); save() } }, ms)
const agentOf = id => state.agents.find(one => one.id === id)
const messageOf = (from, to, kind, text, extra = {}) => {
  const at = Date.now()
  state.messages.push({ id: `${at}-dev${++seq}-${from}-${to}`.replace(/[^A-Za-z0-9_-]/g, '_'), at, from, to, kind, text, ...extra })
  state.messages = state.messages.slice(-200)
}
const ack = (id, ok, status, text) => {
  if (!id) return
  state.acks = [...(state.acks || []), { id, ok, status, text, at: Date.now() }].slice(-50)
}

function play(cmd) {
  if (cmd.cmd === 'chat') {
    later(500, () => {
      const agent = agentOf(cmd.agentId)
      if (!agent) return ack(cmd.id, false, 'failed', 'No such agent in this session')
      const isMain = agent.kind === 'orchestrator'
      messageOf('you', agent.id, 'chat', cmd.text, cmd.id ? { ackId: cmd.id } : {})
      if (isMain) ack(cmd.id, true, 'queued', 'Claude reads it when it finishes its current turn')
      else ack(cmd.id, true, 'delivered', 'It reads it at its next step')
      later(2500, () => {
        if (isMain) {
          const reply = `**Noted.** I'll take that into the plan once this step ends.\n\n(The dev deck made this reply up.)`
          messageOf('main', 'you', 'answer', reply)
          agent.result = reply
        } else messageOf(agent.id, 'you', 'chat', 'Got it: I will work that in at my next step. (The dev deck made this reply up.)')
      })
    })
  } else if (cmd.cmd === 'answer') {
    later(600, () => {
      const item = (state.pending || []).find(one => one.id === cmd.callId)
      if (!item) return ack(cmd.id, false, 'failed', 'No longer pending')
      state.pending = state.pending.filter(one => one !== item)
      const asked = (item.questions || []).map(one => one.question)
      // the mod says the question in Talk as it is asked; a fixture without it gets it now
      if (!state.messages.some(m => m.kind === 'question' && m.callId === item.id)) messageOf(item.agentId, 'you', 'question', asked.join('\n\n'), { callId: item.id })
      messageOf('you', item.agentId, 'choice', `You answered: ${asked.map(q => cmd.answers[q]).filter(Boolean).join('; ')}`, { callId: item.id, ...(cmd.id ? { ackId: cmd.id } : {}) })
      ack(cmd.id, true, 'answered', 'Claude carries on')
      const agent = agentOf(item.agentId)
      if (agent && !(state.pending || []).some(one => one.agentId === agent.id)) Object.assign(agent, { status: 'running', needsYou: null, now: 'Carries on with your answer' })
      const next = (state.pending || [])[0]
      const who = next && agentOf(next.agentId)
      state.needs = next && who
        ? { tone: 'attention', kind: 'blocked', text: `${who.label} ${who.needsYou || 'waits on you'}`, agentId: who.id }
        : { tone: 'quiet', kind: 'busy', text: 'Nothing needs you' }
    })
  } else if (cmd.cmd === 'review') {
    // as on Desktop: the review goes to the Orchestrator as your next prompt, logged like a chat
    later(500, () => {
      messageOf('you', 'main', 'chat', cmd.text, cmd.id ? { ackId: cmd.id } : {})
      ack(cmd.id, true, 'queued', 'Claude reviews it when it finishes its current turn')
    })
  }
}

// ---- the server
const args = [path.join(__dirname, 'server.js'), '--dir', dir, '--parent', String(process.pid)]
if (!isStatic) reset()
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

if (!isStatic) {
  let timer = null
  fs.watch(FIXTURES, (_, name) => { if (name === 'state.json') { clearTimeout(timer); timer = setTimeout(reset, 150) } })
}

const tidy = () => { if (!isStatic) try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* in use: the OS clears its temp */ } }
server.on('exit', code => { tidy(); process.exit(code ?? 0) })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => { server.kill(); tidy(); process.exit(0) })
