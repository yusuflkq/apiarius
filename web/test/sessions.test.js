/**
 * Every session on this machine on the web (All sessions): the server serves
 * another session's state and lazy files under /s/<id>/ (only a live
 * session's, only from a `.web/<id>` folder its registry file names) and
 * passes a chat, an answer or a view naming a session on to the mod; the page
 * lists the sessions (#/sessions), opens one's deck read-only (#/s/<id>/…)
 * under "Viewing <title>", reads its files from /s/<id>/, and sends an
 * answer or a message to its own deck only where that deck takes one. The
 * sample is web/fixtures/sessions.v2.json and web/fixtures/sessions/.
 */
'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')

const WEB = path.join(__dirname, '..')
const SERVER = path.join(WEB, 'server.js')
const TOKEN = 'test-token-0123456789abcdef'
const SAMPLE = JSON.parse(fs.readFileSync(path.join(WEB, 'fixtures', 'state.v2.json'), 'utf8'))
const SESSIONS = JSON.parse(fs.readFileSync(path.join(WEB, 'fixtures', 'sessions.v2.json'), 'utf8'))
const byTitle = title => SESSIONS.entries.find(one => one.title === title)
const SITE = byTitle('Landing page copy')
const NOTES = byTitle('Notes sync')
const SITE_STATE = JSON.parse(fs.readFileSync(path.join(WEB, 'fixtures', SITE.dir, 'state.json'), 'utf8'))
const temps = []
const children = new Set()

// ---------------------------------------------------------------- the server

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Starts a server over `dir` with `args`; resolves with its port and the lines it printed after its ready line. */
function start(dir, args = []) {
  const child = spawn(process.execPath, [SERVER, '--dir', dir, ...args], { env: { ...process.env, AGENT_DECK_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  children.add(child)
  const server = { child, port: 0, lines: [] }
  let buffer = ''
  return new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8').on('data', chunk => {
      buffer += chunk
      let at
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        if (!server.port) { server.port = JSON.parse(line).ready; resolve(server) } else server.lines.push(line)
      }
    })
    child.on('exit', code => { children.delete(child); if (!server.port) reject(new Error(`exited ${code}`)) })
  })
}

function request(port, target, { method = 'GET', headers = { 'X-Deck-Token': TOKEN }, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers }, res => {
      let text = ''
      res.setEncoding('utf8').on('data', chunk => { text += chunk }).on('end', () => resolve({ status: res.statusCode, body: text }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

const post = (port, body) => request(port, '/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Deck-Token': TOKEN, Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) })

let root = ''
let registry = ''
let main = null
let plain = null
const OTHER = 'aa11-bb22'

/** A registry file, as a session's deck writes it: live now unless `extra` says otherwise. */
function listed(id, dir, extra = {}) {
  fs.writeFileSync(path.join(registry, `${id}.json`), JSON.stringify({ v: 1, id, dir, heartbeatAt: Date.now(), inbox: true, ...extra }))
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-sessions-'))
  temps.push(root)
  registry = path.join(root, 'registry')
  fs.mkdirSync(registry)
  const own = path.join(root, '.web', 'me-1')
  fs.mkdirSync(own, { recursive: true })
  fs.writeFileSync(path.join(own, 'state.json'), JSON.stringify({ v: 1, now: 1 }))
  // another session's folder, as the mod makes one, and its lazy files
  const other = path.join(root, '.web', OTHER)
  for (const sub of ['agents', 'patches', 'messages', 'gitdiffs']) fs.mkdirSync(path.join(other, sub), { recursive: true })
  fs.writeFileSync(path.join(other, 'state.json'), JSON.stringify({ v: 1, now: 2, v2: { v: 2, now: 2 } }))
  fs.writeFileSync(path.join(other, 'agents', 'main.json'), '{"v":2,"id":"main"}')
  fs.writeFileSync(path.join(other, 'patches', 'toolu_1.diff'), '@@ -1 +1 @@\n-a\n+b\n')
  fs.writeFileSync(path.join(other, 'messages', 'm1.md'), 'The whole answer.\n')
  fs.writeFileSync(path.join(other, 'gitdiffs', 'abc-def-1.diff'), '@@ -0,0 +1 @@\n+x\n')
  fs.writeFileSync(path.join(root, 'secret.json'), '{"secret":true}')
  listed(OTHER, other)
  // a stale one, an ended one, one naming a folder the deck does not make, one naming a folder no session's
  fs.mkdirSync(path.join(root, '.web', 'stale-1'), { recursive: true })
  fs.writeFileSync(path.join(root, '.web', 'stale-1', 'state.json'), '{"v":1}')
  listed('stale-1', path.join(root, '.web', 'stale-1'), { heartbeatAt: Date.now() - 10 * 60_000 })
  listed('ended-1', other, { endedAt: Date.now() })
  listed('odd-1', root)
  listed('wrong-1', other)
  main = await start(own, ['--sessions', registry])
  plain = await start(own)
})

after(async () => {
  const running = [...children].filter(child => child.exitCode === null && child.signalCode === null)
  await Promise.all(running.map(child => new Promise(resolve => { child.once('exit', resolve); child.kill() })))
  for (const temp of temps) { try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 }) } catch {} }
})

test('/s/<id>/state serves a live session`s state from the folder its registry file names; its lazy files as this session`s are served', async () => {
  const state = await request(main.port, `/s/${OTHER}/state`)
  assert.equal(state.status, 200)
  assert.deepEqual(JSON.parse(state.body), { v: 1, now: 2, v2: { v: 2, now: 2 } })
  assert.equal((await request(main.port, `/s/${OTHER}/agent/main`)).body, '{"v":2,"id":"main"}')
  assert.equal((await request(main.port, `/s/${OTHER}/patch/toolu_1`)).body, '@@ -1 +1 @@\n-a\n+b\n')
  assert.equal((await request(main.port, `/s/${OTHER}/message/m1`)).body, 'The whole answer.\n')
  assert.equal((await request(main.port, `/s/${OTHER}/gitdiff/abc-def-1`)).body, '@@ -0,0 +1 @@\n+x\n')
  assert.equal((await request(main.port, `/s/${OTHER}/patch/nope`)).status, 404)
})

test('/s/ refuses: no token, a session not listed, stale or ended, a folder not `.web/<its id>`, a path for an id, any other file; and a server with no registry serves none', async () => {
  assert.equal((await request(main.port, `/s/${OTHER}/state`, { headers: {} })).status, 403)
  for (const id of ['nobody', 'stale-1', 'ended-1', 'odd-1', 'wrong-1', '..%2F..%2Fsecret', 'a.b']) assert.equal((await request(main.port, `/s/${id}/state`)).status, 404, id)
  assert.equal((await request(main.port, `/s/${OTHER}/agent/..%2F..%2F..%2Fsecret`)).status, 400)
  assert.equal((await request(main.port, `/s/${OTHER}/secret.json`)).status, 404)
  assert.equal((await request(main.port, `/s/${OTHER}/state/extra`)).status, 404)
  assert.equal((await request(main.port, `/s/${OTHER}/__proto__/x`)).status, 404)
  assert.equal((await request(plain.port, `/s/${OTHER}/state`)).status, 404)
})

test('POST /cmd passes a chat or an answer naming a session, and view; nothing else may name one; a server with no registry takes none', async () => {
  const count = main.lines.length
  const sent = [
    { cmd: 'view', session: OTHER },
    { cmd: 'chat', id: 'c1', agentId: 'main', text: 'Rebuild it', session: OTHER },
    { cmd: 'answer', id: 'a1', callId: 'toolu_1', answers: { 'Which?': 'Redis' }, session: OTHER },
  ]
  for (const body of sent) assert.equal((await post(main.port, body)).status, 200)
  for (const body of [{ cmd: 'stopAgent', agentId: 'x', session: OTHER }, { cmd: 'review', text: 'x', session: OTHER }, { cmd: 'chat', agentId: 'main', text: 'x', session: '../x' }, { cmd: 'view' }, { cmd: 'view', session: OTHER, text: 'x' }]) {
    assert.equal((await post(main.port, body)).status, 400, JSON.stringify(body))
  }
  assert.equal((await post(plain.port, { cmd: 'view', session: OTHER })).status, 400)
  for (let i = 0; i < 40 && main.lines.length < count + 3; i++) await sleep(50)
  assert.deepEqual(main.lines.slice(count).map(line => JSON.parse(line)), [
    { cmd: 'view', session: OTHER },
    { cmd: 'chat', id: 'c1', agentId: 'main', text: 'Rebuild it', session: OTHER },
    { cmd: 'answer', id: 'a1', callId: 'toolu_1', answers: { 'Which?': 'Redis' }, session: OTHER },
  ])
})

// ------------------------------------------------------------------ the page

const AVATARS = require('../avatars.mjs')
const IMPORT = "import * as AV from './avatars.mjs';"
const SOURCE = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(IMPORT, 'const AV = __avatars;').replace("import * as TL from './timeline.mjs';", 'const TL = __timeline;')
const NOW = SAMPLE.now

/** A page at `hash` (app.js in a vm, no DOM): its fetch answers /cmd, /s/<id>/state with `others[id]`, and every other GET from `files`; calls kept. */
function page({ hash = '', others = {}, files = {} } = {}) {
  const noop = () => {}
  const calls = []
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => JSON.parse(body), text: async () => body })
  const fetch = async (url, init = {}) => {
    calls.push({ url: url.replace(/\?.*$/, ''), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (url === '/cmd') return reply(200, '{"ok":true}')
    const state = /^\/s\/([^/]+)\/state/.exec(url)
    if (state) return others[decodeURIComponent(state[1])] ? reply(200, JSON.stringify(others[decodeURIComponent(state[1])])) : reply(404, 'no such session\n')
    const plainUrl = url.replace(/\?.*$/, '')
    if (files[plainUrl] !== undefined) return reply(200, files[plainUrl])
    return new Promise(noop)
  }
  const location = { search: '?t=test-token', hash }
  const context = vm.createContext({
    __deckTest: true, __avatars: AVATARS, __timeline: require('../timeline.mjs'), location, window: { addEventListener: noop }, document: { title: '', querySelector: () => null, getElementById: () => null },
    localStorage: { getItem: () => null, setItem: noop }, requestAnimationFrame: () => 1, cancelAnimationFrame: noop, setTimeout: () => 1, clearTimeout: noop, setInterval: () => 1,
    performance: { now: () => 0 }, fetch, URLSearchParams,
  })
  vm.runInContext(SOURCE, context, { filename: 'app.js' })
  vm.runInContext(`Date.now = () => ${NOW}; renderNow = () => {}`, context)
  const run = js => vm.runInContext(js, context)
  return {
    run, calls, location,
    load(state) { context.__state = JSON.parse(JSON.stringify(state)); run('apply(__state)') },
    text: js => flat(textOf(run(js))),
    go(hash) { location.hash = hash; run('setRoute(parseRoute())') },
  }
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)) }
const flat = text => text.replace(/\s+/g, ' ').trim()
function textOf(v) {
  if (v == null || v === false || v === true) return ''
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(' ')
  if (v.t === '#') return v.s
  if (v.p && v.p.html != null) return ''
  return (v.c || []).map(textOf).filter(Boolean).join(' ')
}
function findAll(v, ok, out = []) {
  if (!v || typeof v !== 'object') return out
  if (Array.isArray(v)) { for (const one of v) findAll(one, ok, out); return out }
  if (v.t !== '#' && ok(v)) out.push(v)
  for (const child of v.c || []) findAll(child, ok, out)
  return out
}
const byClass = (v, cls) => findAll(v, one => !!one.p && typeof one.p.class === 'string' && one.p.class.split(' ').includes(cls))

/** The live state as the mod writes it: the sample, with every session on its machine. */
const LIVE = { ...SAMPLE, sessions: SESSIONS.view }

test('the rail beside a wide page: the brand, "This machine" (◆ 2 need you · 2 agents working), then each session, here`s first and tagged "here", the one shown lit; each row its dot, title, where it runs, what it needs or does, its needs` badge, its faces while it works (seeded by its id), its spend; the header`s button hides it', () => {
  const p = page({ hash: '#/now' })
  p.run('window.innerWidth = 1280')
  p.load(LIVE)
  const app = p.run('App()')
  assert.match(app.p.class, /\bhas-rail\b/)
  const rail = byClass(app, 'rail')[0]
  assert.match(flat(textOf(rail)), /^Agent Deck This machine ◆ 2 need you · 2 agents working Sessions 5 /)
  assert.match(flat(textOf(rail)), /Every Claude Code session on this machine whose deck runs\. s moves here; ↑ ↓ pick\.$/)
  const rows = byClass(rail, 'rail-row')
  assert.equal(rows.length, 5)
  // here first, lit (it shows), "here" its quiet tag; a press keeps the tab
  assert.equal(rows[0].p.href, '#/now')
  assert.match(rows[0].p.class, /\bon\b/)
  assert.equal(flat(textOf(byClass(rows[0], 'rail-here')[0])), 'here')
  assert.equal(byClass(rows[0], 'tab-n')[0].c[0].s, '4')
  const site = rows.find(row => flat(textOf(row)).includes('Landing page copy'))
  assert.equal(site.p.href, `#/s/${SITE.id}/now`)
  assert.equal(flat(textOf(site)), 'Landing page copy Terminal · site Needs your OK: Bash rm -rf dist 1 ≈$0.22')
  assert.equal(byClass(site, 'rail-say')[0].p.class, 'rail-say is-need')
  // faces while it works: its two agents at work, seeded by its id (no other session's alike)
  const faces = rows.find(row => flat(textOf(row)).includes('Agent Deck terminal faces'))
  assert.equal(byClass(faces, 'sess-faces').length, 1)
  assert.equal(byClass(rows.find(row => flat(textOf(row)).includes('Notes sync')), 'sess-faces').length, 0)
  assert.deepEqual(JSON.parse(p.run(`JSON.stringify(facesOf(sessionsNow().rows.find(r => r.title === 'Agent Deck terminal faces')))`)), { seeds: [faces.k, `${faces.k}:1`], more: 0 })
  // the header: no brand (the rail holds it), its button lit; pressed, the rail hides, and "◆ 1 needs you" says the other waiting on you
  assert.equal(byClass(p.run('Header()'), 'brand-mark').length, 0)
  assert.equal(p.run('RailToggle()').p['aria-pressed'], 'true')
  p.run('toggleRail()')
  assert.equal(p.run('Rail()'), null)
  assert.doesNotMatch(p.run('App()').p.class, /\bhas-rail\b/)
  assert.equal(p.text('RailToggle()'), '◆ 1 needs you Sessions')
  assert.equal(byClass(p.run('Header()'), 'brand-mark').length, 1)
})

test('the rail where the page is narrow: shut, the header`s button opens it over the page (a scrim behind it), a pick shuts it; a mod that lists no sessions draws none', () => {
  const p = page({ hash: '#/chat' })
  p.run('window.innerWidth = 700')
  p.load(LIVE)
  assert.equal(p.run('Rail()'), null)
  assert.doesNotMatch(p.run('App()').p.class, /\bhas-rail\b/)
  p.run('toggleRail()')
  const [scrim, aside] = p.run('Rail()')
  assert.equal(scrim.p.class, 'rail-scrim')
  assert.equal(aside.p.class, 'rail is-over')
  assert.doesNotMatch(p.run('App()').p.class, /\bhas-rail\b/)
  // a row keeps the tab shown: Chat of the session picked
  assert.equal(byClass(aside, 'rail-row').find(row => flat(textOf(row)).includes('Landing page copy')).p.href, `#/s/${SITE.id}/chat`)
  p.run('railPicked()')
  assert.equal(p.run('Rail()'), null)
  const q = page({ hash: '#/now' })
  q.run('window.innerWidth = 1280')
  q.load(SAMPLE)
  assert.equal(q.run('Rail()'), null)
  assert.equal(q.run('RailToggle()'), null)
})

test('This machine (#/sessions): what needs you counted, then each session its row, here`s first: its dot, title and "here", where it runs, its need in amber or what it does, its faces, its word, spend (an estimate, a fork`s counting its parent`s) and age; a deck not heard from lately says when it was, no state; a press shows its deck', () => {
  const quiet = { ...LIVE, sessions: { ...SESSIONS.view, rows: SESSIONS.view.rows.map(r => (r.title === 'Notes sync' ? { ...r, isQuiet: true, heardAt: NOW - 125_000, stateText: '', need: null, needs: 0, say: 'Last heard 2m ago' } : r)) } }
  const p = page({ hash: '#/sessions' })
  p.load(quiet)
  const v = p.run('Page()')
  assert.match(p.text('Page()'), /^This machine ◆ 2 need you · 5 sessions · 2 agents working /)
  const rows = byClass(v, 'sess-row')
  assert.equal(rows.length, 5)
  assert.equal(rows[0].p.href, '#/now')
  assert.match(flat(textOf(rows[0])), /^Also exempt .* here /)
  assert.doesNotMatch(p.text('Page()'), /this chat/)
  const site = rows.find(row => flat(textOf(row)).includes('Landing page copy'))
  assert.equal(site.p.href, `#/s/${SITE.id}/now`)
  assert.equal(flat(textOf(site)), 'Landing page copy Terminal · site · Needs your OK: Bash rm -rf dist Waiting on you ≈$0.22 9m')
  assert.equal(byClass(site, 'sess-say')[0].p.class, 'sess-say is-need')
  // a quiet deck: its dot hollow, when it was last heard on the page's clock, no state word
  const notes = rows.find(row => flat(textOf(row)).includes('Notes sync'))
  assert.match(notes.p.class, /\bis-quiet\b/)
  assert.equal(byClass(notes, 'dot-quiet').length, 1)
  assert.match(flat(textOf(notes)), /Desktop · notes · Last heard 2m ago ≈\$0\.31 2h$/)
  // a fork's spend began at the session it was forked from: "incl. its parent's" under it, as the mod words it
  const faces = rows.find(row => flat(textOf(row)).includes('Agent Deck terminal faces'))
  assert.match(faces.p.class, /\bis-fork\b/)
  assert.equal(byClass(faces, 'sess-faces').length, 1)
  assert.match(flat(textOf(faces)), /Working ≈\$1\.80 now incl\. its parent’s$/)
  assert.deepEqual([site, notes].map(row => byClass(row, 'sess-cost-note').length), [0, 0])
  const q = page({ hash: '#/sessions' })
  q.load(SAMPLE)
  assert.match(q.text('Page()'), /No sessions listed/)
})

test('s moves the focus to the rail (opening it where it is shut), on the session shown; there, s gives the page the focus back; ↑ ↓ pick the entry before or after it; a mod that lists no sessions takes no s', () => {
  const p = page({ hash: '#/chat' })
  p.run('window.innerWidth = 1280')
  p.load(LIVE)
  p.run('toggleRail()')
  assert.equal(p.run('Rail()'), null)
  assert.equal(p.run("keyAction('s')"), true)
  assert.notEqual(p.run('Rail()'), null)
  assert.equal(p.run('ui.focusTo'), `rail-${SAMPLE.session.id}`)
  // a DOM of the rail's entries: This machine, then the sessions, the focus on the first session
  p.run(`(() => {
    const hrefs = ['#/sessions', ...sessionsNow().rows.map(r => rowHref(r))]
    const items = hrefs.map((href, i) => ({ href, i, focused: false, getAttribute: () => href, focus() { items.forEach(x => (x.focused = false)); this.focused = true; document.activeElement = this }, closest: function () { return this }, blur() { document.activeElement = null }, classList: { contains: () => false } }))
    globalThis.__items = items
    document.querySelectorAll = () => items
    items[1].focus()
  })()`)
  p.run('railStep(1)')
  assert.equal(p.location.hash, `#/s/${SESSIONS.view.rows[1].id}/chat`)
  p.run('railStep(-1); railStep(-1)')
  assert.equal(p.location.hash, '#/sessions')
  p.run('railStep(-1)')
  assert.equal(p.location.hash, '#/sessions')
  // s there: the focus back to the page
  p.run("document.activeElement.closest = s => (s === '.rail' ? {} : document.activeElement)")
  assert.equal(p.run("keyAction('s')"), true)
  assert.equal(p.run('document.activeElement'), null)
  const q = page({ hash: '#/now' })
  q.load(SAMPLE)
  assert.equal(q.run("keyAction('s')"), false)
})

test('another session`s deck in this one`s place (#/s/<id>/…): read from /s/<id>/state, its deck asked to keep writing it (view); its own header, no bar and no Back; its row lit in the rail; its permission prompt says where to answer it; its tabs keep it; its lazy files come from /s/<id>/; here picked again shows this one`s', async () => {
  const p = page({ hash: `#/s/${SITE.id}/now`, others: { [SITE.id]: { v: 1, now: SITE_STATE.now, v2: SITE_STATE } } })
  p.run('window.innerWidth = 1280')
  p.load(LIVE)
  p.run('switchView(route.session)')
  await settle()
  assert.deepEqual(p.calls.filter(one => one.url === '/cmd').map(one => one.body), [{ cmd: 'view', session: SITE.id }])
  assert.ok(p.calls.some(one => one.url === `/s/${SITE.id}/state`))
  assert.equal(p.run('S.header.goal.headline'), 'Landing page copy')
  assert.deepEqual(JSON.parse(p.run('JSON.stringify(S.peer)')), { where: 'Terminal · site', canSteer: true })
  assert.equal(p.run('hrefOf("chat", null)'), `#/s/${SITE.id}/chat`)
  assert.equal(p.run('baseUrl()'), `/s/${SITE.id}`)
  // its header is its own; no Viewing bar, no Back, nothing "read-only" or "this chat"
  assert.match(p.text('Header()'), /Waiting on you Landing page copy/)
  const all = p.text('App()')
  for (const gone of ['Viewing', 'Back to this chat', 'Read-only', 'this chat']) assert.doesNotMatch(all, new RegExp(gone))
  // the rail lights it, here's row not
  const rows = byClass(p.run('Rail()')[1], 'rail-row')
  assert.match(rows.find(row => flat(textOf(row)).includes('Landing page copy')).p.class, /\bon\b/)
  assert.doesNotMatch(rows[0].p.class, /\bon\b/)
  // its permission prompt: answered in its window, named
  assert.match(p.text('NeedsList()'), /Answer it in its window: Terminal · site\./)
  assert.doesNotMatch(p.text('NeedsList()'), /in Claude Code/)
  // here again: this session's own state
  p.go('#/now')
  assert.equal(p.run('S.header.goal.headline'), SAMPLE.header.goal.headline)
  assert.equal(p.run('S.peer'), undefined)
})

test('another session`s controls that act only in its window say so where they stand: Stop turn, its background`s Stop and Cancel (one line under its list), an agent`s Stop in its drawer; its notification; its questions answer through its own deck', async () => {
  const theirs = { ...SAMPLE, session: { ...SAMPLE.session, id: SITE.id } }
  const p = page({ hash: `#/s/${SITE.id}/now`, others: { [SITE.id]: theirs } })
  p.load(LIVE)
  p.run('switchView(route.session)')
  await settle()
  // Stop turn: where to stop it, never the button
  assert.equal(byClass(p.run('Header()'), 'stop-turn').length, 0)
  assert.match(p.text('Header()'), /Stop the turn in its window/)
  // background: no Stop or Cancel, one line that says where
  const bg = p.run('BackgroundSection()')
  assert.equal(byClass(bg, 'bg-stop').length, 0)
  assert.match(flat(textOf(bg)), /Stop them in its window: Terminal · site\.$/)
  // its agents: no Stop on a card, and the drawer says where
  assert.equal(p.run('S.agents.filter(a => a.stop && a.stop.can).length'), 0)
  assert.deepEqual(JSON.parse(p.run("JSON.stringify(S.agents.filter(a => a.stop).map(a => a.stop.why))")), SAMPLE.agents.filter(a => a.stop).map(() => 'Stop it in its window: Terminal · site.'))
  p.go(`#/s/${SITE.id}/now/agent/b81c6f3e2a9d4c17`)
  assert.match(p.text('Drawer()'), /Stop it in its window: Terminal · site\./)
  // its permission prompt and its notification: in its window; its questions: through its own deck, or in its window
  const needs = p.text('NeedsList()')
  assert.match(needs, /Or answer it in its window: Terminal · site\./)
  assert.equal(p.run("S.needs.filter(n => n.isAnswerable).length"), SAMPLE.needs.filter(n => n.isAnswerable).length)
})

test('steering another session from the page: a message to it goes with its id (its own deck takes it); a deck that reads no inbox is answered "Answer it in its window"; nothing else goes from its deck, said where to do it', async () => {
  const notesState = JSON.parse(fs.readFileSync(path.join(WEB, 'fixtures', NOTES.dir, 'state.json'), 'utf8'))
  const p = page({ hash: `#/s/${SITE.id}/chat`, others: { [SITE.id]: SITE_STATE, [NOTES.id]: notesState } })
  p.load(LIVE)
  p.run('switchView(route.session)')
  await settle()
  await p.run("command({ cmd: 'chat', id: 'c-1', agentId: 'main', text: 'Rebuild it' })")
  assert.deepEqual(p.calls.filter(one => one.url === '/cmd').map(one => one.body).at(-1), { cmd: 'chat', id: 'c-1', agentId: 'main', text: 'Rebuild it', session: SITE.id })
  await assert.rejects(p.run("command({ cmd: 'clearFinished', id: 'x' })"), /This is another session's deck\. Do that in its window: Terminal · site\./)
  await assert.rejects(p.run("command({ cmd: 'review', id: 'x', text: 'y' })"), /Do that in its window/)
  p.go(`#/s/${NOTES.id}/now`)
  await settle()
  await assert.rejects(p.run("command({ cmd: 'chat', id: 'c-2', agentId: 'main', text: 'Hello' })"), /Answer it in its window/)
  // its questions read-only here: none answerable
  assert.equal(p.run('S.needs.some(n => n.isAnswerable)'), false)
  assert.deepEqual(JSON.parse(p.run('JSON.stringify(S.peer)')), { where: 'Desktop · notes', canSteer: false })
})

test('a session no longer listed: its deck says so, its header says what it can, and the page stays on it until you pick another', async () => {
  const p = page({ hash: '#/s/gone-1/now' })
  p.load(LIVE)
  p.run('switchView(route.session)')
  await settle()
  assert.equal(p.run('S'), null)
  assert.match(p.text('Page()'), /That session is not running any more/)
  assert.match(p.text('Header()'), /Reading Another session/)
})
