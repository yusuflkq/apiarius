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
  const child = spawn(process.execPath, [SERVER, '--dir', dir, ...args], { env: { ...process.env, APIARIUS_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
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

test('POST /cmd passes every command about a session naming one (an answer, a message, Stop, Stop turn, Cancel, Clear finished, Show cleared, a pick, Review), each checked as this session`s, and view; the avatar style and ping may not name one; a server with no registry takes none', async () => {
  const count = main.lines.length
  const sent = [
    { cmd: 'view', session: OTHER },
    { cmd: 'chat', id: 'c1', agentId: 'main', text: 'Rebuild it', session: OTHER },
    { cmd: 'answer', id: 'a1', callId: 'toolu_1', answers: { 'Which?': 'Redis' }, session: OTHER },
    { cmd: 'stopAgent', id: 's1', agentId: 'builder-1', session: OTHER },
    { cmd: 'abortTurn', id: 's2', turnId: 'turn_9', session: OTHER },
    { cmd: 'abortTurn', id: 's3', session: OTHER },
    { cmd: 'stopBackground', id: 's4', bgId: 'bash_1', session: OTHER },
    { cmd: 'clearFinished', id: 'k1', session: OTHER },
    { cmd: 'showCleared', id: 'k2', session: OTHER },
    { cmd: 'selectRepo', id: 'r1', root: '', session: OTHER },
    { cmd: 'review', id: 'v1', text: 'Review it', session: OTHER },
  ]
  for (const body of sent) assert.equal((await post(main.port, body)).status, 200, JSON.stringify(body))
  const refused = [
    { cmd: 'avatarStyle', style: 'critter', session: OTHER },
    { cmd: 'ping', session: OTHER },
    // each checked as this session's: no stray key, no bad field
    { cmd: 'stopAgent', agentId: 'x', extra: 1, session: OTHER },
    { cmd: 'stopBackground', bgId: '../x', session: OTHER },
    { cmd: 'abortTurn', turnId: 'a b', session: OTHER },
    { cmd: 'clearFinished', all: true, session: OTHER },
    { cmd: 'selectRepo', root: 'a\nb', session: OTHER },
    { cmd: 'review', text: ' ', session: OTHER },
    { cmd: 'chat', agentId: 'main', text: 'x', session: '../x' },
    { cmd: 'view' },
    { cmd: 'view', session: OTHER, text: 'x' },
  ]
  for (const body of refused) assert.equal((await post(main.port, body)).status, 400, JSON.stringify(body))
  assert.equal((await post(plain.port, { cmd: 'view', session: OTHER })).status, 400)
  assert.equal((await post(plain.port, { cmd: 'stopAgent', agentId: 'x', session: OTHER })).status, 400)
  for (let i = 0; i < 40 && main.lines.length < count + sent.length; i++) await sleep(50)
  assert.deepEqual(main.lines.slice(count).map(line => JSON.parse(line)), sent)
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
const click = v => v.p.onClick({ preventDefault() {}, stopPropagation() {}, target: {} })

/** The live state as the mod writes it: the sample, with every session on its machine. */
const LIVE = { ...SAMPLE, sessions: SESSIONS.view }

test('the header: the brand; after the title a quiet "here" on this page`s own deck; All sessions (#/sessions), after "◆ 1 other session needs you" in amber while a session but the one shown waits on you (a quiet one counted nowhere), lit on its page; a mod that lists no sessions draws neither', () => {
  const p = page({ hash: '#/now' })
  p.load(LIVE)
  const header = p.run('Header()')
  assert.equal(byClass(header, 'brand-mark').length, 1)
  // the tag right after the title, inside the title's box
  assert.match(p.text('Header()'), /^Waiting on you Also exempt \/health and \/metrics from the limiter\. \S+ here /)
  assert.equal(flat(textOf(byClass(byClass(header, 'hd-title')[0], 'hd-where')[0])), 'here')
  const link = byClass(header, 'hd-sessions')[0]
  assert.equal(link.t, 'a')
  assert.equal(link.p.href, '#/sessions')
  assert.equal(flat(textOf(link)), '◆ 1 other session needs you All sessions')
  assert.equal(byClass(link, 'hd-sessions-need').length, 1)
  assert.doesNotMatch(link.p.class, /\bon\b/)
  assert.equal(byClass(p.run('App()'), 'rail').length, 0)
  // two others waiting; a quiet one waiting counted nowhere
  const rowsAs = f => ({ ...LIVE, sessions: { ...SESSIONS.view, rows: SESSIONS.view.rows.map(f) } })
  p.load(rowsAs(r => (r.title === 'Fix the flaky CI job' ? { ...r, state: 'waiting', stateText: 'Waiting on you' } : r)))
  assert.equal(p.text('SessionsLink()'), '◆ 2 other sessions need you All sessions')
  p.load(rowsAs(r => (r.title === 'Landing page copy' ? { ...r, isQuiet: true, heardAt: NOW - 125_000, stateText: '', need: null, needs: 0 } : r)))
  assert.equal(p.text('SessionsLink()'), 'All sessions')
  // the link opens All sessions, lit there; a row there keeps the tab it was opened from
  p.load(LIVE)
  p.go('#/org')
  p.go('#/sessions')
  assert.match(p.run('SessionsLink()').p.class, /\bon\b/)
  assert.equal(byClass(p.run('Page()'), 'sess-row')[0].p.href, '#/org')
  const q = page({ hash: '#/now' })
  q.load(SAMPLE)
  assert.equal(q.run('SessionsLink()'), null)
  assert.equal(q.run('WhereTag()'), null)
})

test('All sessions (#/sessions): "This machine" and what needs you counted, then each session its row, here`s first and lit: its dot, title, "here" and its needs` amber badge, where it runs, its need in amber or what it does, its faces over its agents` count, its word, spend (an estimate, a fork`s counting its parent`s) and age; a deck not heard from lately says when it was, no state; a press shows its deck; the keys at the foot', () => {
  const quiet = { ...LIVE, sessions: { ...SESSIONS.view, rows: SESSIONS.view.rows.map(r => (r.title === 'Notes sync' ? { ...r, isQuiet: true, heardAt: NOW - 125_000, stateText: '', need: null, needs: 0, agents: 3, say: 'Last heard 2m ago' } : r)) } }
  const p = page({ hash: '#/sessions' })
  p.load(quiet)
  const v = p.run('Page()')
  assert.match(p.text('Page()'), /^All sessions This machine · ◆ 2 need you · 2 agents working /)
  assert.match(p.text('Page()'), /What you do there goes through its own deck; only a permission prompt is answered in its window\. ↑ ↓ pick one, Enter shows its deck, s goes back\.$/)
  const rows = byClass(v, 'sess-row')
  assert.equal(rows.length, 5)
  // here first: opened with no deck before it, its row lit; its badge and its agents counted
  assert.equal(rows[0].p.href, '#/now')
  assert.equal(rows[0].p.id, `sess-${SAMPLE.session.id}`)
  assert.deepEqual(rows.map(row => /\bon\b/.test(row.p.class)), [true, false, false, false, false])
  assert.match(flat(textOf(rows[0])), /^Also exempt \/health and \/metrics from the limiter\. here 4 Desktop · acme-api · Orchestrator asks: .* 7 agents Waiting on you ≈\$4\.12 /)
  assert.doesNotMatch(p.text('Page()'), /this chat/)
  const site = rows.find(row => flat(textOf(row)).includes('Landing page copy'))
  assert.equal(site.p.href, `#/s/${SITE.id}/now`)
  assert.equal(flat(textOf(site)), 'Landing page copy 1 Terminal · site · Needs your OK: Bash rm -rf dist Waiting on you ≈$0.22 9m')
  assert.equal(byClass(site, 'sess-say')[0].p.class, 'sess-say is-need')
  assert.equal(byClass(site, 'tab-n')[0].p.class, 'tab-n is-need')
  // a quiet deck: its dot hollow, when it was last heard on the page's clock, no state word, badge or agents
  const notes = rows.find(row => flat(textOf(row)).includes('Notes sync'))
  assert.match(notes.p.class, /\bis-quiet\b/)
  assert.equal(byClass(notes, 'dot-quiet').length, 1)
  assert.equal(flat(textOf(notes)), 'Notes sync Desktop · notes · Last heard 2m ago ≈$0.31 2h')
  // its agents' faces while they work, each as its own deck draws it (its id the seed, its title the name), its agents under them; a fork's spend began at the session it was forked from: "incl. its parent's" under it, as the mod words it
  const faces = rows.find(row => flat(textOf(row)).includes('Apiarius terminal faces'))
  assert.match(faces.p.class, /\bis-fork\b/)
  assert.equal(byClass(faces, 'sess-faces').length, 1)
  assert.equal(byClass(faces, 'sess-faces')[0].p.title, '2 agents working')
  assert.equal(flat(textOf(byClass(faces, 'sess-face')[0])), '2 agents')
  const theirs = JSON.parse(fs.readFileSync(path.join(WEB, 'fixtures', byTitle('Apiarius terminal faces').dir, 'state.json'), 'utf8')).agents.filter(a => a.row === 'agent' && a.kind !== 'orchestrator' && a.status === 'running')
  assert.deepEqual(theirs.map(a => a.title), ['builder', 'painter'])
  assert.deepEqual(JSON.parse(p.run(`JSON.stringify(facesOf(sessionsNow().rows.find(r => r.title === 'Apiarius terminal faces')))`)), { faces: theirs.map(a => ({ id: a.id, title: a.title, status: 'running' })), more: 0 })
  // the Orchestrator at work alone: its word and dot say it works, and no face stands for it
  const ci = rows.find(row => flat(textOf(row)).includes('Fix the flaky CI job'))
  assert.match(flat(textOf(ci)), / Working ≈\$0\.64 /)
  assert.deepEqual([site, notes, ci].map(row => byClass(row, 'sess-faces').length), [0, 0, 0])
  assert.match(flat(textOf(faces)), /Working ≈\$1\.80 now incl\. its parent’s$/)
  assert.deepEqual([site, notes].map(row => byClass(row, 'sess-cost-note').length), [0, 0])
  const q = page({ hash: '#/sessions' })
  q.load(SAMPLE)
  assert.match(q.text('Page()'), /^All sessions No sessions listed/)
})

test('All sessions in Monogram tiles: a row draws only its own agents at work, each with the letters its deck gives it ("Bl", "Pn"); a session whose Orchestrator alone works draws no face, nothing of its title ("lemme see…") made one; an earlier mod`s row that names no agents draws none, whatever it counts', () => {
  const solo = { ...SESSIONS.view.rows.find(r => r.title === 'Fix the flaky CI job'), id: 'solo-1', title: 'lemme see the sessions', faces: [] }
  const older = { ...SESSIONS.view.rows.find(r => r.title === 'Apiarius terminal faces'), id: 'older-2', title: 'An earlier mod', faces: undefined }
  const p = page({ hash: '#/sessions' })
  p.load({ ...LIVE, avatarStyle: 'mono', sessions: { ...SESSIONS.view, rows: [...SESSIONS.view.rows, solo, older] } })
  const rows = byClass(p.run('Page()'), 'sess-row')
  const svgOf = row => findAll(row, one => one.t === 'img').map(img => decodeURIComponent(img.p.src.replace(/^data:image[/]svg[+]xml;charset=utf-8,/, '')))
  const faces = rows.find(row => flat(textOf(row)).includes('Apiarius terminal faces'))
  const [stack] = svgOf(byClass(faces, 'sess-face')[0])
  assert.deepEqual([...stack.matchAll(/>([^<>]+)<\/text>/g)].map(m => m[1]), ['Bl', 'Pn'])
  for (const title of ['lemme see the sessions', 'An earlier mod']) {
    const row = rows.find(one => flat(textOf(one)).includes(title))
    assert.match(flat(textOf(row)), / Working /)
    assert.deepEqual([byClass(row, 'sess-faces').length, svgOf(byClass(row, 'sess-face')[0])], [0, []])
  }
  assert.doesNotMatch(JSON.stringify(rows.map(svgOf)), />Lm</)
})

test('s opens All sessions, the focus on the row of the deck shown, a row picked keeping the tab you came from; ↑ ↓ there move the focus down and up the rows (Enter follows one); s again goes back where you were; a mod that lists no sessions takes no s', () => {
  const p = page({ hash: '#/chat' })
  p.load(LIVE)
  assert.equal(p.run("keyAction('s')"), true)
  assert.equal(p.location.hash, '#/sessions')
  assert.equal(p.run('route.tab'), 'sessions')
  assert.equal(p.run('ui.focusTo'), `sess-${SAMPLE.session.id}`)
  const rows = byClass(p.run('Page()'), 'sess-row')
  assert.match(rows[0].p.class, /\bon\b/)
  assert.equal(rows[0].p.href, '#/chat')
  assert.equal(rows.find(row => flat(textOf(row)).includes('Landing page copy')).p.href, `#/s/${SITE.id}/chat`)
  // a DOM of the page's rows, the focus on here's
  p.run(`(() => {
    const items = sessionsNow().rows.map(r => ({ id: r.id, getClientRects: () => [{}], focus() { document.activeElement = this }, scrollIntoView() {}, closest() { return this } }))
    const page = { querySelectorAll: s => (s === '[data-nav]' ? items : []) }
    document.querySelector = s => (s === '.scroll' ? page : null)
    document.querySelectorAll = () => items
    items[0].focus()
  })()`)
  assert.equal(p.run("keyAction('ArrowDown')"), true)
  assert.equal(p.run('document.activeElement.id'), SESSIONS.view.rows[1].id)
  p.run("keyAction('ArrowDown'); keyAction('ArrowDown')")
  assert.equal(p.run('document.activeElement.id'), SESSIONS.view.rows[3].id)
  assert.equal(p.run("keyAction('ArrowUp')"), true)
  assert.equal(p.run('document.activeElement.id'), SESSIONS.view.rows[2].id)
  // s again: back on Chat; there ↑ ↓ are the browser's
  assert.equal(p.run("keyAction('s')"), true)
  assert.equal(p.location.hash, '#/chat')
  assert.equal(p.run('route.tab'), 'chat')
  assert.equal(p.run("keyAction('ArrowDown')"), false)
  const q = page({ hash: '#/now' })
  q.load(SAMPLE)
  assert.equal(q.run("keyAction('s')"), false)
  assert.equal(q.run('route.tab'), 'now')
})

test('another session`s deck in this one`s place (#/s/<id>/…): read from /s/<id>/state, its deck asked to keep writing it (view); its own header, where it runs after its title, no bar and no Back; its row lit on All sessions; its permission prompt says where to answer it; its tabs keep it; its lazy files come from /s/<id>/; here picked again shows this one`s', async () => {
  const p = page({ hash: `#/s/${SITE.id}/now`, others: { [SITE.id]: { v: 1, now: SITE_STATE.now, v2: SITE_STATE } } })
  p.load(LIVE)
  // before its state is read: its row's state, title and where it runs
  assert.match(p.text('Header()'), /^Waiting on you Landing page copy Terminal · site /)
  p.run('switchView(route.session)')
  await settle()
  assert.deepEqual(p.calls.filter(one => one.url === '/cmd').map(one => one.body), [{ cmd: 'view', session: SITE.id }])
  assert.ok(p.calls.some(one => one.url === `/s/${SITE.id}/state`))
  assert.equal(p.run('S.header.goal.headline'), 'Landing page copy')
  assert.deepEqual(JSON.parse(p.run('JSON.stringify(S.peer)')), { where: 'Terminal · site', canSteer: true, why: '' })
  assert.equal(p.run('hrefOf("chat", null)'), `#/s/${SITE.id}/chat`)
  assert.equal(p.run('baseUrl()'), `/s/${SITE.id}`)
  // its header is its own, where it runs right after its title (no "here"); no Viewing bar, no Back, nothing "read-only" or "this chat"
  assert.match(p.text('Header()'), /Waiting on you Landing page copy/)
  assert.equal(flat(textOf(byClass(byClass(p.run('Header()'), 'hd-title')[0], 'hd-where')[0])), 'Terminal · site')
  assert.doesNotMatch(p.text('Header()'), /\bhere\b/)
  // here waits on you too: the one other waiting
  assert.equal(p.text('SessionsLink()'), '◆ 1 other session needs you All sessions')
  const all = p.text('App()')
  for (const gone of ['Viewing', 'Back to this chat', 'Read-only', 'this chat']) assert.doesNotMatch(all, new RegExp(gone))
  // its permission prompt: answered in its window, named
  assert.match(p.text('NeedsList()'), /Answer it in its window: Terminal · site\./)
  assert.doesNotMatch(p.text('NeedsList()'), /in Claude Code/)
  // s: All sessions, its row lit and focused, here's not; s again: back on its deck
  assert.equal(p.run("keyAction('s')"), true)
  assert.equal(p.run('ui.focusTo'), `sess-${SITE.id}`)
  const rows = byClass(p.run('Page()'), 'sess-row')
  assert.match(rows.find(row => flat(textOf(row)).includes('Landing page copy')).p.class, /\bon\b/)
  assert.doesNotMatch(rows[0].p.class, /\bon\b/)
  assert.equal(p.run("keyAction('s')"), true)
  assert.equal(p.location.hash, `#/s/${SITE.id}/now`)
  await settle()
  assert.equal(p.run('S.header.goal.headline'), 'Landing page copy')
  // here again: this session's own state
  p.go('#/now')
  assert.equal(p.run('S.header.goal.headline'), SAMPLE.header.goal.headline)
  assert.equal(p.run('S.peer'), undefined)
})

test('another session`s deck shows the controls its own window would, by its own deck`s state: Stop turn, its background`s Stop and Cancel, an agent`s Stop on its card and in its drawer, Clear finished; a press goes to its own deck and says what came of it at the control (Stopping…, then its ack in that deck`s state); only a permission prompt and Claude Code`s notification say to answer them in its window', async () => {
  const theirs = { ...SAMPLE, session: { ...SAMPLE.session, id: SITE.id } }
  const p = page({ hash: `#/s/${SITE.id}/now`, others: { [SITE.id]: theirs } })
  p.load(LIVE)
  p.run('switchView(route.session)')
  await settle()
  const sent = () => p.calls.filter(one => one.url === '/cmd').map(one => one.body).filter(one => one.cmd !== 'view')
  const viewed = next => { p.run(`applyViewed(${JSON.stringify(next)})`) }
  // its controls are its own: Stop turn, and every Stop and Cancel its own deck's check allows
  assert.equal(byClass(p.run('Header()'), 'stop-turn').length, 1)
  assert.equal(byClass(p.run('BackgroundSection()'), 'bg-stop').length, SAMPLE.background.rows.filter(x => x.stop && x.stop.can).length)
  assert.deepEqual(JSON.parse(p.run('JSON.stringify(S.agents.filter(a => a.stop && a.stop.can).map(a => a.id))')), SAMPLE.agents.filter(a => a.stop && a.stop.can).map(a => a.id))
  assert.equal(byClass(p.run('AgentsSection()'), 'run-stop').length, SAMPLE.agents.filter(a => a.stop && a.stop.can).length)
  assert.equal(byClass(p.run('AgentsSection()'), 'fin-clear').length, 1)
  for (const gone of ['in its window', 'another session']) {
    assert.doesNotMatch(p.text('Header()'), new RegExp(gone))
    assert.doesNotMatch(p.text('BackgroundSection()'), new RegExp(gone))
    assert.doesNotMatch(p.text('AgentsSection()'), new RegExp(gone))
  }
  // Stop turn: to its own deck, its turn named; "Stopping…" until that deck's ack, then gone with its turn, the ack a toast
  click(byClass(p.run('Header()'), 'stop-turn')[0])
  await settle()
  const turn = sent().at(-1)
  assert.deepEqual(turn, { cmd: 'abortTurn', turnId: SAMPLE.header.turn.id, id: turn.id, session: SITE.id })
  assert.equal(flat(textOf(byClass(p.run('Header()'), 'stop-turn')[0])), 'Stopping…')
  assert.equal(byClass(p.run('Header()'), 'stop-turn')[0].p.disabled, true)
  const later = (s, acks) => ({ ...s, now: s.now + 1000, acks: [...s.acks, ...acks.map(one => ({ at: NOW, ...one }))] })
  let next = later({ ...theirs, header: { ...theirs.header, turn: null } }, [{ id: turn.id, ok: true, status: 'delivered', text: 'Stopped the turn' }])
  viewed(next)
  assert.equal(byClass(p.run('Header()'), 'stop-turn').length, 0)
  assert.equal(p.run('ui.toast.text'), 'Stopped the turn')
  // a Stop its deck could not make: the row says why, and its Stop is there again
  click(byClass(p.run('BackgroundSection()'), 'bg-stop')[0])
  await settle()
  const bg = sent().at(-1)
  assert.deepEqual(bg, { cmd: 'stopBackground', bgId: SAMPLE.background.rows[0].id, id: bg.id, session: SITE.id })
  assert.equal(flat(textOf(byClass(p.run('BackgroundSection()'), 'bg-stop')[0])), '…')
  next = later(next, [{ id: bg.id, ok: false, status: 'failed', text: 'Claude Code refused TaskStop: not now' }])
  viewed(next)
  const row = byClass(p.run('BackgroundSection()'), 'bg-row')[0]
  assert.equal(flat(textOf(byClass(row, 'press-note')[0])), '✕ Claude Code refused TaskStop: not now')
  assert.equal(flat(textOf(byClass(row, 'bg-stop')[0])), 'Stop')
  // Clear finished: to its own deck, "Clearing…", then what it did beside the row
  click(byClass(p.run('AgentsSection()'), 'fin-clear')[0])
  await settle()
  const clear = sent().at(-1)
  assert.deepEqual(clear, { cmd: 'clearFinished', id: clear.id, session: SITE.id })
  assert.equal(flat(textOf(byClass(p.run('AgentsSection()'), 'fin-clear')[0])), 'Clearing…')
  next = later(next, [{ id: clear.id, ok: true, status: 'delivered', text: 'Cleared 5 finished agents from the deck' }])
  viewed(next)
  assert.equal(flat(textOf(byClass(p.run('AgentsSection()'), 'press-note')[0])), '✓ Cleared 5 finished agents from the deck')
  // an agent's Stop, from its drawer
  p.go(`#/s/${SITE.id}/now/agent/b81c6f3e2a9d4c17`)
  click(byClass(p.run('Drawer()'), 'stop-drawer')[0])
  await settle()
  assert.deepEqual(sent().at(-1), { cmd: 'stopAgent', agentId: 'b81c6f3e2a9d4c17', id: sent().at(-1).id, session: SITE.id })
  assert.match(p.text('Drawer()'), /Stopping…/)
  assert.doesNotMatch(p.text('Drawer()'), /Stop it in its window/)
  // its permission prompt and its notification: in its window, the one exception; its questions through its own deck
  p.go(`#/s/${SITE.id}/now`)
  const needs = p.text('NeedsList()')
  assert.equal(p.text("PermissionBody(S.needs.find(n => n.kind === 'permission'))").endsWith('Answer it in its window: Terminal · site.'), true)
  assert.equal(p.text("NoteBody(S.needs.find(n => n.kind === 'notification'))").endsWith('Answer it in its window: Terminal · site.'), true)
  assert.doesNotMatch(needs, /Or answer it in its window/)
  assert.match(needs, /Or answer it in Claude Code\./)
  assert.equal(p.run('S.needs.filter(n => n.isAnswerable).length'), SAMPLE.needs.filter(n => n.isAnswerable).length)
})

test('steering another session from the page: every command about it goes with its id to its own deck (the avatar style stays the person`s, this deck`s own); a deck that reads no inbox, or one gone quiet, says so at its controls before a press, "Its deck isn`t answering", and nothing goes', async () => {
  const notesState = JSON.parse(fs.readFileSync(path.join(WEB, 'fixtures', NOTES.dir, 'state.json'), 'utf8'))
  const theirs = { ...SAMPLE, session: { ...SAMPLE.session, id: SITE.id } }
  const p = page({ hash: `#/s/${SITE.id}/chat`, others: { [SITE.id]: theirs, [NOTES.id]: notesState } })
  p.load(LIVE)
  p.run('switchView(route.session)')
  await settle()
  const sent = () => p.calls.filter(one => one.url === '/cmd').map(one => one.body)
  for (const cmd of ["{ cmd: 'chat', id: 'c-1', agentId: 'main', text: 'Rebuild it' }", "{ cmd: 'clearFinished', id: 'k-1' }", "{ cmd: 'review', id: 'v-1', text: 'Review it' }", "{ cmd: 'selectRepo', id: 'r-1', root: '' }", "{ cmd: 'showCleared', id: 'k-2' }"]) {
    await p.run(`command(${cmd})`)
    assert.equal(sent().at(-1).session, SITE.id, cmd)
  }
  assert.deepEqual(sent().at(-5), { cmd: 'chat', id: 'c-1', agentId: 'main', text: 'Rebuild it', session: SITE.id })
  // the avatar style is the person's: this deck's own, naming no session
  await p.run("command({ cmd: 'avatarStyle', id: 'a-1', style: 'critter' })")
  assert.deepEqual(sent().at(-1), { cmd: 'avatarStyle', id: 'a-1', style: 'critter' })
  // a deck that reads no inbox (an older build): said before a press, at each control; a press sends nothing
  p.go(`#/s/${NOTES.id}/now`)
  await settle()
  const why = "Its deck isn't answering: it runs an older Apiarius."
  assert.deepEqual(JSON.parse(p.run('JSON.stringify(S.peer)')), { where: 'Desktop · notes', canSteer: false, why })
  assert.equal(p.run('S.needs.some(n => n.isAnswerable)'), false)
  const before = sent().length
  await assert.rejects(p.run("command({ cmd: 'chat', id: 'c-2', agentId: 'main', text: 'Hello' })"), new RegExp(why.replace('.', '\\.')))
  assert.equal(sent().length, before)
  // a deck gone quiet: its Stop turn, Stop and Cancel, Clear finished, questions and composer say so up front
  const quiet = { ...LIVE, sessions: { ...SESSIONS.view, rows: SESSIONS.view.rows.map(r => (r.id === SITE.id ? { ...r, isQuiet: true, heardAt: NOW - 125_000, stateText: '', need: null, needs: 0 } : r)) } }
  const q = page({ hash: `#/s/${SITE.id}/now`, others: { [SITE.id]: theirs } })
  q.load(quiet)
  q.run('switchView(route.session)')
  await settle()
  const said = "Its deck isn't answering: last heard 2m ago."
  assert.equal(q.run('S.peer.why'), said)
  assert.equal(byClass(q.run('Header()'), 'stop-turn').length, 0)
  assert.equal(flat(textOf(byClass(q.run('Header()'), 'hd-peer-stop')[0])), "Its deck isn't answering")
  assert.equal(byClass(q.run('Header()'), 'hd-peer-stop')[0].p.title, said)
  const bgs = q.run('BackgroundSection()')
  assert.equal(byClass(bgs, 'bg-stop').length, 0)
  assert.match(flat(textOf(bgs)), new RegExp(`${said.replace('.', '\\.')}$`))
  assert.equal(byClass(q.run('AgentsSection()'), 'fin-clear').length, 0)
  assert.match(q.text('AgentsSection()'), /Its deck isn't answering: last heard 2m ago\./)
  assert.equal(q.run('S.needs.some(n => n.isAnswerable)'), false)
  assert.match(q.text('NeedsList()'), /Its deck isn't answering: last heard 2m ago\./)
  assert.equal(q.run("previewOf('chat', '').text"), said)
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
