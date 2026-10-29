/**
 * The page's views on the v2 state, without a browser: app.js runs in a vm
 * context with no DOM (it boots nothing there), each test hands it a state as
 * the server would, and reads the text of the virtual DOM a view builds. The
 * state is the v2 sample (web/fixtures/state.v2.json, made by the mod's own
 * builder), and the lazy files are the sample's (web/fixtures/v2/).
 */
'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const WEB = path.join(__dirname, '..')
// app.js is a module whose one import is the avatar library: here it runs as a script, the library handed in as AV
const AVATARS = require('../avatars.mjs')
const IMPORT = "import * as AV from './avatars.mjs';"
const MODULE = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8')
assert.ok(MODULE.includes(IMPORT), 'app.js imports the avatar library')
const SOURCE = MODULE.replace(IMPORT, 'const AV = __avatars;')
const SAMPLE = JSON.parse(fs.readFileSync(path.join(WEB, 'fixtures', 'state.v2.json'), 'utf8'))
const NOW = SAMPLE.now
const MIN = 60_000

/** The sample's lazy files of one kind (agents, patches, messages, gitdiffs), by id. */
const lazy = kind => Object.fromEntries(fs.readdirSync(path.join(WEB, 'fixtures', 'v2', kind)).map(file => [file.replace(/\.[^.]+$/, ''), fs.readFileSync(path.join(WEB, 'fixtures', 'v2', kind, file), 'utf8')]))
const FILES = { agent: lazy('agents'), patch: lazy('patches'), message: lazy('messages'), gitdiff: lazy('gitdiffs'), timeline: fs.readFileSync(path.join(WEB, 'fixtures', 'v2', 'timeline.json'), 'utf8') }

const BUILDER = 'b81c6f3e2a9d4c17'
const RESEARCHER = 'a3f9c2e1b7d4058e'
const REVIEWER = 'aa11bb22cc33dd44'
const LINT = 'd2e3f4a5b6c7089a'
const TESTER = 'c4d7e8f9a0b1263d'
const DOCS = 'e5f6a7b8c9d0142b'
const SCOUT = 'f1e2d3c4b5a6978c'
const ASK_ONE = 'toolu_01AskOne'
const ASK_MANY = 'toolu_01AskMany'
const Q_STORE = 'Which store should back the limiter in production?'
const Q_ROUTES = 'Which routes should skip the limiter?'

/** The sample, a fresh copy, with `change` applied to it. */
function sample(change) {
  const s = JSON.parse(JSON.stringify(SAMPLE))
  if (change) change(s)
  return s
}

/**
 * A fresh page at `hash`, its clock at `now`: app.js in a context of its own.
 * Its fetch answers POST /cmd with {"ok":true} and GET /agent, /patch,
 * /message and /gitdiff from `files` (the sample's by default); every call is
 * kept in `calls` (a command's body parsed). Its localStorage is `storage`, a
 * plain object (a fresh one by default). Rendering is a no-op: the views are
 * read, not drawn.
 */
function page({ hash = '', now = NOW, files = FILES, storage = {} } = {}) {
  const noop = () => {}
  const calls = []
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => JSON.parse(body), text: async () => body })
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (url === '/cmd') return reply(200, '{"ok":true}')
    if (url.startsWith('/timeline')) return files.timeline === undefined ? reply(404, 'no such timeline\n') : reply(200, files.timeline)
    const m = /^\/(agent|patch|message|gitdiff)\/([^?]+)/.exec(url)
    if (m) {
      const text = files[m[1]][decodeURIComponent(m[2])]
      return text === undefined ? reply(404, 'no such file\n') : reply(200, text)
    }
    return new Promise(noop)
  }
  const context = vm.createContext({
    __deckTest: true,
    __avatars: AVATARS,
    location: { search: '?t=test-token', hash },
    window: { addEventListener: noop },
    document: { title: '', querySelector: () => null, getElementById: () => null },
    localStorage: { getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v) } },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: noop,
    setTimeout: () => 1,
    clearTimeout: noop,
    setInterval: () => 1,
    performance: { now: () => 0 },
    fetch,
    URLSearchParams,
  })
  vm.runInContext(SOURCE, context, { filename: 'app.js' })
  vm.runInContext(`Date.now = () => ${now}; renderNow = () => {}`, context)
  const run = js => vm.runInContext(js, context)
  return {
    run,
    calls,
    storage,
    /** The commands the page posted, oldest first. */
    commands: () => calls.filter(one => one.url === '/cmd').map(one => one.body),
    /** The lazy files the page fetched, by path, in order. */
    fetched: kind => calls.filter(one => one.url.startsWith(`/${kind}/`)).map(one => one.url.replace(/\?.*$/, '')),
    load(state) {
      context.__state = JSON.parse(JSON.stringify(state))
      run('apply(__state)')
    },
    view: js => run(js),
    /** The text `js` builds, each run of white space one space. */
    text: js => flat(textOf(run(js))),
    setNow: t => run(`Date.now = () => ${t}`),
    /** A key pressed on the page (on `tag`: an element of that tag has the focus). */
    key: (key, tag = 'BODY') => run(`(() => { const e = { key: ${JSON.stringify(key)}, target: { tagName: ${JSON.stringify(tag)}, blur() {} }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }; onKey(e); return e.defaultPrevented })()`),
    open: js => run(`navigate(route.tab, ${js})`),
  }
}

/** Lets the page's fetches and their promise chains settle. */
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)) }

/** Every vnode under `v` that `test` accepts. */
function findAll(v, test, out = []) {
  if (!v || typeof v !== 'object') return out
  if (Array.isArray(v)) {
    for (const one of v) findAll(one, test, out)
    return out
  }
  if (v.t !== '#' && test(v)) out.push(v)
  for (const child of v.c || []) findAll(child, test, out)
  return out
}

/** Every vnode under `v` whose class has `cls`. */
const find = (v, cls) => findAll(v, one => !!one.p && typeof one.p.class === 'string' && one.p.class.split(' ').includes(cls))

/** The first element under `v` of class `cls` whose text holds `text`. */
function byText(v, cls, text) {
  const found = find(v, cls).find(one => flat(textOf(one)).includes(text))
  assert.ok(found, `no .${cls} with "${text}"`)
  return found
}

/** Text with each run of white space as one space, trimmed. */
const flat = text => text.replace(/\s+/g, ' ').trim()

/** Clicks a vnode: runs its onClick as the browser would. */
const click = v => v.p.onClick({ preventDefault() {}, stopPropagation() {}, target: {} })

/** A vnode's text, its children's joined by spaces; icons' markup left out. */
function textOf(v) {
  if (v == null || v === false || v === true) return ''
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(' ')
  if (v.t === '#') return v.s
  if (v.p && v.p.html != null) return ''
  return (v.c || []).map(textOf).filter(Boolean).join(' ')
}

// ---- reading the state

test('reads the live state (v1 with v2 under its key) and the bare sample alike; nothing yet, or an older mod`s state, shows the welcome', () => {
  const live = page()
  live.load({ v: 1, now: NOW, session: { id: SAMPLE.session.id }, agents: [], v2: SAMPLE })
  assert.equal(live.run('IX.rows.length'), 8)
  assert.equal(live.run('S.empty'), false)
  const bare = page()
  bare.load(SAMPLE)
  assert.equal(bare.text('Header()'), live.text('Header()'))
  // the server's state before the mod wrote one
  const empty = page()
  empty.load({ v: 1, empty: true })
  assert.match(empty.text('Page()'), /Nothing yet Prompt Claude Code and this page fills in live/)
  // a state with no v2 in it: an older mod
  const old = page()
  old.load({ v: 1, now: NOW, session: { id: 'x' }, agents: [] })
  assert.match(old.text('Page()'), /older than this page/)
  // never traded for nothing, and an older write of the same session never replaces a newer one
  bare.load({ v: 1, empty: true })
  assert.equal(bare.run('S.empty'), false)
  bare.load(sample(s => { s.now = NOW - 1000; s.header.stateText = 'Stale' }))
  assert.match(bare.text('Header()'), /^Waiting on you/)
})

test('the header: the state in one word, your latest request in your words, and model · mode · context · cost, the mode lit; the goal opens on its whole text', async () => {
  const p = page()
  p.load(SAMPLE)
  assert.match(p.text('Header()'), new RegExp(`^Waiting on you Also exempt /health and /metrics from the limiter\\. 4m opus-5\\.5 · auto mode · context 41% · ≈\\$4\\.12 Stop turn Dashboard 4 Chat Org Changes ${SAMPLE.changes.files.length} Inspect Settings`))
  // the permission mode, lit as Claude Code's footer lights it; the whole line on hover
  assert.deepEqual(find(p.view('Header()'), 'hd-mode').map(one => flat(textOf(one))), ['auto mode', 'auto mode'])
  assert.equal(find(p.view('Header()'), 'hd-line')[0].p.title, 'opus-5.5 · auto mode · context 41% · ≈$4.12')
  click(find(p.view('Header()'), 'goal')[0])
  assert.match(p.text('Header()'), /Your latest request · 4m ago Also exempt \/health and \/metrics from the limiter\./)
  // a goal the state cut short: its whole text from /message/<messageId>, fetched once
  const cut = page({ files: { ...FILES, message: { ...FILES.message, 'm-goal': 'The whole of it, every word.' } } })
  cut.load(sample(s => Object.assign(s.header.goal, { text: 'The whole of…', isCut: true, messageId: 'm-goal' })))
  cut.run('ui.goalOpen = true')
  assert.match(cut.text('GoalPanel()'), /Loading the rest…/)
  await settle()
  assert.match(cut.text('GoalPanel()'), /The whole of it, every word\./)
  assert.deepEqual(cut.fetched('message'), ['/message/m-goal'])
  // idle, with nothing known yet of the model, the context or the cost
  p.load(sample(s => Object.assign(s.header, { state: 'idle', stateText: 'Idle', goal: null, line: '', turn: null })))
  assert.match(p.text('Header()'), /^Idle No request yet Dashboard 4/)
})

test('Now is called the Dashboard: its tab says so; its route stays #/now, and #/dashboard (and #/) open it too', () => {
  const p = page({ hash: '#/dashboard' })
  p.load(SAMPLE)
  assert.equal(p.run('route.tab'), 'now')
  const tabs = () => find(p.view('Header()'), 'tab')
  assert.deepEqual(tabs().map(t => flat(textOf(t))), ['Dashboard 4', 'Chat', 'Org', `Changes ${SAMPLE.changes.files.length}`, 'Inspect', 'Settings'])
  assert.deepEqual(tabs().map(t => t.p.href), ['#/now', '#/chat', '#/org', '#/changes', '#/inspect', '#/settings'])
  assert.ok(tabs()[0].p.class.includes(' on'))
  p.key('2')
  p.key('1')
  assert.equal(p.run('location.hash'), '#/now')
  assert.equal(p.run('route.tab'), 'now')
  for (const hash of ['#/', '#/now', '#/dashboard/', '#/nowhere']) assert.equal(page({ hash }).run('route.tab'), 'now', hash)
  // what pointed at Now says Dashboard
  assert.match(p.text('HelpSection()'), /Dashboard What needs you/)
})

// ---- Now: needs

test('Needs: oldest first, each with its age; the first open, the rest one line each; a permission shows its exact command and "Answer in Claude Code"; a notification its words', () => {
  const p = page()
  p.load(SAMPLE)
  const cards = () => find(p.view('NeedsSection()'), 'need')
  assert.deepEqual(cards().map(c => c.p.id), [`need-${ASK_ONE}`, 'need-toolu_01BldB2', `need-${ASK_MANY}`, 'need-note_1792013520000_elicitation_dialog_main'])
  assert.deepEqual(cards().map(c => textOf(find(c, 'need-age')[0])), ['3m', '2m', '2m', '1m'])
  assert.deepEqual(cards().map(c => c.p.class.includes('open')), [true, false, false, false])
  assert.equal(flat(textOf(find(cards()[1], 'need-head')[0])), 'builder needs permission npm test -- rateLimit Bash 2m')
  assert.equal(flat(textOf(find(cards()[3], 'need-head')[0])), 'github The github MCP server is asking for your input 1m')
  // opened: the exact command, what it says it does, and where to answer it
  click(find(cards()[1], 'need-flip')[0])
  assert.match(flat(textOf(cards()[1])), /^builder needs permission Bash 2m npm test -- rateLimit Run the limiter tests Answer in Claude Code\.$/)
  assert.equal(find(cards()[1], 'permit-cmd').length, 1)
  click(find(cards()[3], 'need-head')[0])
  // its type in plain words beside its title ("MCP input", not elicitation_dialog)
  assert.match(flat(textOf(cards()[3])), /^github MCP input 1m The github MCP server is asking for your input Answer in Claude Code\.$/)
  // a state of an earlier build, with no words for the type: the type as sent
  p.load(sample(s => delete s.needs[3].typeText))
  assert.match(flat(textOf(cards()[3])), /^github elicitation_dialog 1m /)
  p.load(sample())
  // a path where there is no command
  p.load(sample(s => Object.assign(s.needs[1], { tool: 'Edit', command: undefined, path: 'src/app.ts', text: 'src/app.ts' })))
  assert.match(flat(textOf(cards()[1])), /src\/ app\.ts Answer in Claude Code\.$/)
  // ages run on: a state not written again for five minutes still says how old each need is
  p.setNow(NOW + 5 * MIN)
  assert.deepEqual(cards().map(c => textOf(find(c, 'need-age')[0])), ['8m', '7m', '7m', '6m'])
  // nothing needs you: no section at all
  p.load(sample(s => { s.needs = [] }))
  assert.equal(p.view('NeedsSection()'), null)
  assert.doesNotMatch(p.text('NowPage()'), /Needs you/)
})

test('a question answers inline, by its need`s id, and collapses to "Answered: X"; one with several answers takes a Submit; one the mod cannot take is read-only', async () => {
  const p = page()
  p.load(SAMPLE)
  const first = () => find(p.view('NeedsSection()'), 'need')[0]
  assert.ok(find(first(), 'q-opt').every(o => o.t === 'button' && o.p.role == null), 'plain buttons: a click answers')
  click(byText(first(), 'q-opt', 'Redis'))
  await settle()
  const [cmd] = p.commands()
  assert.match(cmd.id, /^[A-Za-z0-9_-]{1,40}$/)
  assert.deepEqual(cmd, { cmd: 'answer', id: cmd.id, callId: ASK_ONE, answers: { [Q_STORE]: 'Redis' } })
  assert.match(textOf(first()), /Sending your answer…/)
  assert.ok(find(first(), 'q-opt').every(o => o.p.disabled === true))
  // answered: it collapses at once, the need still in the state or not
  const answered = { id: cmd.id, ok: true, status: 'answered', text: 'Claude carries on', at: NOW }
  p.load(sample(s => s.acks.push(answered)))
  assert.equal(flat(textOf(p.view('NeedsSection()').c.filter(Boolean)[1].c[0])), `Answered: Redis ${Q_STORE} now`)
  p.load(sample(s => { s.acks.push(answered); s.needs.shift(); s.chat.push({ id: 'm-c', at: NOW, from: 'you', to: 'main', who: 'You → Orchestrator', kind: 'choice', text: 'You answered: Redis', callId: ASK_ONE, ackId: cmd.id }) }))
  assert.match(p.text('NeedsSection()'), /^Needs you 3 Answered: Redis Which store should back the limiter in production\? now/)
  // a while later it is gone
  p.setNow(NOW + 21_000)
  p.load(sample(s => { s.now = NOW + 21_000; s.acks.push(answered); s.needs.shift() }))
  assert.doesNotMatch(p.text('NeedsSection()'), /Answered/)

  // several answers: the reviewer's checkboxes, opened, joined in their order with Other text last
  const q = page()
  q.load(SAMPLE)
  const reviewer = () => find(q.view('NeedsSection()'), 'need')[2]
  click(find(reviewer(), 'need-flip')[0])
  assert.deepEqual(find(reviewer(), 'q-opt').map(o => o.p.role), ['checkbox', 'checkbox', 'checkbox'])
  assert.equal(byText(reviewer(), 'btn', 'Submit').p.disabled, true)
  click(byText(reviewer(), 'q-opt', '/metrics'))
  click(byText(reviewer(), 'q-opt', '/health'))
  find(reviewer(), 'q-other-input')[0].p.onInput({ target: { value: '/status' } })
  click(byText(reviewer(), 'btn', 'Submit'))
  await settle()
  assert.deepEqual(q.commands()[0].answers, { [Q_ROUTES]: '/health, /metrics, /status' })
  // a question the mod cannot take (it reloaded): its options read-only
  q.load(sample(s => { s.needs[0].isAnswerable = false }))
  const ro = find(q.view('NeedsSection()'), 'need')[0]
  assert.deepEqual(find(ro, 'q-opt').map(o => o.t), ['div', 'div', 'div'])
  assert.equal(findAll(find(ro, 'need-body')[0], v => v.t === 'button' || v.t === 'input').length, 0)
  assert.match(flat(textOf(ro)), /Answer it in Claude Code\.$/)
})

// ---- Now: the dashboard

/** The sample with the dashboard's own lists (the figures, the activity, the files) as these tests give them. */
const dash = change => sample(s => { Object.assign(s, { figures: { ...FIGURES }, activity: FEED, files: TOUCHED }); if (change) change(s) })

test('Now is the dashboard: needs, a run card per agent, the figures, the plan, recent activity and files, in that order; a head folds its section and the page remembers it; n opens Needs again', () => {
  const p = page()
  p.load(dash())
  const order = () => [...p.view('NowPage()').c].filter(Boolean).flatMap(v => (v.k === 'cols' ? v.c.filter(Boolean) : [v])).map(v => v.k)
  assert.deepEqual(order(), ['needs', 'agents', 'background', 'figures', 'plan', 'activity', 'files'])
  assert.equal(find(p.view('NowPage()'), 'dash-cols').length, 1, 'activity and files share a row where the page is wide')
  // nothing needs you, no plan and nothing in the background: none leaves a trace
  p.load(dash(s => { s.needs = []; s.plan = null; s.figures.plan = null; s.background = { rows: [], tasks: 0, scheduled: 0, text: '' } }))
  assert.deepEqual(order(), ['agents', 'figures', 'activity', 'files'])
  // a head folds its section: the head stays, the body goes, and so it stays on the next load
  p.load(dash())
  const sec = id => find(p.view('NowPage()'), `sec-${id}`)[0]
  const fold = id => find(sec(id), 'sec-fold')[0]
  assert.equal(fold('activity').p['aria-expanded'], 'true')
  click(fold('activity'))
  assert.equal(fold('activity').p['aria-expanded'], 'false')
  assert.ok(sec('activity').p.class.includes('shut'))
  assert.equal(flat(textOf(sec('activity'))), 'Recent activity')
  assert.deepEqual(JSON.parse(p.storage['agent-deck:shut']), ['activity'])
  const again = page({ storage: p.storage })
  again.load(dash())
  assert.equal(find(find(again.view('NowPage()'), 'sec-activity')[0], 'ra-row').length, 0)
  click(fold('activity'))
  assert.ok(find(sec('activity'), 'ra-row').length > 0)
  assert.deepEqual(JSON.parse(p.storage['agent-deck:shut']), [])
  // Needs folded: n opens it again, on the need
  click(fold('needs'))
  assert.equal(find(sec('needs'), 'need').length, 0)
  p.key('n')
  assert.equal(find(sec('needs'), 'need').length, 4)
  assert.equal(p.run('ui.scrollTo.id'), `need-${ASK_ONE}`)
})

test('the run cards: the Orchestrator, then each agent at work as it started, the finished behind "N finished ▸"; each its status pill, its own todo in progress (else its task) with n/total, its call in flight verbatim (else its result), model · tokens and when; a click opens it', () => {
  const p = page()
  p.load(SAMPLE)
  const cards = () => find(p.view('AgentsSection()'), 'run-card')
  // those at work or waiting on you in front; the finished (done, failed, stopped, idle) behind one row, Clear finished beside it
  assert.deepEqual(cards().map(c => c.k), ['main', BUILDER, REVIEWER])
  const fold = () => find(p.view('AgentsSection()'), 'fin-fold')[0]
  assert.equal(flat(textOf(fold())), '5 finished ▸')
  assert.equal(flat(textOf(find(p.view('AgentsSection()'), 'fin-clear')[0])), 'Clear finished')
  assert.equal(find(p.view('AgentsSection()'), 'fin-show').length, 0)
  click(fold())
  assert.equal(flat(textOf(fold())), '5 finished ▾')
  assert.deepEqual(cards().map(c => c.k), ['main', BUILDER, REVIEWER, RESEARCHER, DOCS, SCOUT, TESTER, LINT])
  assert.ok(cards().every(c => c.t === 'button' && c.p['data-nav'] === 'agent'))
  const card = id => cards().find(c => c.k === id)
  const part = (id, cls) => flat(textOf(find(card(id), cls)[0]))
  // the Orchestrator: its own todo in progress, 2 of its 4 done, and its call in flight
  assert.equal(part('main', 'run-head'), 'Orchestrator waiting')
  assert.equal(part('main', 'run-step'), 'Write the limiter and its stores 2/4')
  assert.equal(part('main', 'run-now'), 'AskUserQuestion Which store should back the limiter in production?')
  assert.equal(part('main', 'run-foot'), 'opus-5.5 · 1.4M Started 42m ago')
  // an agent with no todos: its task's first line, no count; its call in flight, verbatim
  assert.match(part(BUILDER, 'run-step'), /^Write a sliding-window rate limiter in src\/rateLimit\.ts: 100 requests a minute/)
  assert.equal(find(card(BUILDER), 'run-step-n').length, 0)
  assert.equal(part(BUILDER, 'run-now'), 'Bash npm test -- rateLimit')
  assert.equal(part(BUILDER, 'run-foot'), 'sonnet-4.5 · 513k Started 29m ago')
  // a message woke one that had finished: resumed, its run since then
  p.load(sample(s => Object.assign(s.agents.find(r => r.id === TESTER), { status: 'running', endedAt: null, resumedAt: NOW - MIN })))
  assert.equal(part(TESTER, 'run-foot'), 'haiku-4.5 · 76.9k Resumed 1m ago')
  p.load(SAMPLE)
  // finished: what it handed back, and when; failed or stopped with nothing handed back: the word
  assert.equal(part(TESTER, 'run-head'), 'tester done')
  assert.equal(part(TESTER, 'run-now'), 'Wrote 6 tests in tests/rateLimit.test.ts ; all pass against the in-memory store.')
  assert.equal(part(TESTER, 'run-foot'), 'haiku-4.5 · 76.9k Finished 12m ago')
  assert.equal(part(LINT, 'run-head'), 'Lint the new files failed')
  assert.equal(part(LINT, 'run-now'), 'Failed')
  assert.equal(part(SCOUT, 'run-head'), 'scout stopped')
  assert.equal(part(SCOUT, 'run-foot'), 'haiku-4.5 · 15.3k Stopped 22m ago')
  // the pill and the step's glyph take the status hue
  assert.deepEqual(find(card(BUILDER), 'pill').map(x => x.p.class), ['pill hue-wait'])
  assert.deepEqual(find(card(TESTER), 'pill').map(x => x.p.class), ['pill hue-done'])
  assert.deepEqual(find(find(card(TESTER), 'run-step')[0], 'glyph').map(g => g.p.class), ['glyph hue-done'])
  assert.deepEqual(find(find(card(LINT), 'run-step')[0], 'glyph').map(g => g.p.class), ['glyph hue-fail'])
  // running: the card's blue edge, its step spinning, a live dot by its call
  p.load(sample(s => { s.now += 1000; s.agents.find(r => r.id === BUILDER).status = 'running' }))
  assert.match(card(BUILDER).p.class, /^run-card is-running/)
  assert.ok(find(find(card(BUILDER), 'run-step')[0], 'glyph')[0].p.class.includes('spin'))
  assert.equal(find(card(BUILDER), 'run-live').length, 1)
  assert.equal(find(card('main'), 'run-live').length, 0, 'waiting on you: no live dot')
  // a click opens its drawer
  click(card(BUILDER))
  assert.deepEqual({ ...p.run('route.drawer') }, { kind: 'agent', id: BUILDER })
  assert.ok(card(BUILDER).p.class.includes(' on'))
})

test('past twelve at work, the cards keep the Orchestrator, every one waiting on you and the newest of the rest, and say how many more Org shows', () => {
  const p = page()
  p.load(sample(s => {
    for (let i = 0; i < 12; i++) s.agents.push({ row: 'agent', id: `extra${i}`, parent: 'main', depth: 1, kind: 'agent', status: 'running', title: `extra ${i}`, startedAt: s.now - (12 - i) * 1000, endedAt: null, todos: [] })
  }))
  const shown = find(p.view('AgentsSection()'), 'run-card').map(c => c.k)
  assert.equal(shown.length, 12)
  for (const id of ['main', BUILDER, REVIEWER, 'extra3', 'extra11']) assert.ok(shown.includes(id), id)
  for (const id of ['extra0', 'extra1', 'extra2', TESTER]) assert.ok(!shown.includes(id), id)
  assert.match(p.text('AgentsSection()'), /^Agents 20 3 more in Org Orchestrator/)
  click(find(p.view('AgentsSection()'), 'sec-fold')[0])
  assert.equal(find(p.view('AgentsSection()'), 'run-card').length, 0)
})

const FIGURES = { running: 2, waiting: 1, done: 3, failed: 1, stopped: 1, plan: { done: 1, total: 3 }, costUsd: 4.12, tokens: 2305400, contextPercent: 41, minutes: 40, needs: 4 }

test('the figures, as the state counts them: the agents in each state, the plan`s items done (only with a plan), the spend (an estimate at API prices), what waits on you; each opens what it counts', () => {
  const p = page()
  p.load(sample(s => { s.figures = FIGURES }))
  const tiles = () => find(p.view('FiguresStrip()'), 'kpi')
  assert.deepEqual(tiles().map(k => flat(textOf(k))), [
    '2 Agents running 1 waiting · 3 done · 1 failed · 1 stopped',
    '1/3 Plan done 2 to go',
    '≈$4.12 Spend at API prices 2.3M tokens · 40 min · context 41%',
    '4 Waiting on you Orchestrator asks: Which store should back the limiter in production?',
  ])
  assert.equal(p.view('FiguresStrip()').p.style['--n'], '4')
  // Waiting on you goes to the first need; Agents running to Org; the plan to the plan
  click(tiles()[3])
  assert.equal(p.run('ui.scrollTo.id'), `need-${ASK_ONE}`)
  click(tiles()[1])
  assert.equal(p.run('ui.scrollTo.id'), 'sec-plan')
  click(tiles()[0])
  assert.equal(p.run('route.tab'), 'org')
  // no plan: no Plan tile; nothing waiting: it says so and goes nowhere; nothing known of the spend: a dash
  p.load(sample(s => { s.figures = { ...FIGURES, plan: null, needs: 0, costUsd: null, tokens: null, minutes: null, contextPercent: null }; s.needs = [] }))
  assert.deepEqual(find(p.view('FiguresStrip()'), 'kpi-label').map(textOf), ['Agents running', 'Spend at API prices', 'Waiting on you'])
  assert.equal(flat(textOf(tiles()[1])), '— Spend at API prices —')
  assert.equal(flat(textOf(tiles()[2])), '0 Waiting on you Nothing waits on you')
  assert.equal(tiles()[2].t, 'div')
  // a mod that writes no figures: no strip
  p.load(sample(s => { delete s.figures }))
  assert.equal(p.view('FiguresStrip()'), null)
})

const call = (min, agent, agentName, tool, text, ok, ms) => ({ id: `toolu_feed${min}`, at: NOW - min * MIN, agent, agentName, tool, text, ok, ms })
const FEED = [
  call(3, TESTER, 'tester', 'Edit', 'src/rateLimit.ts', true, 250),
  call(0, BUILDER, 'builder', 'Bash', 'Run the limiter tests', null, null),
  call(1, 'main', 'Orchestrator', 'AskUserQuestion', 'Which store should back the limiter in production?', null, null),
  call(2, LINT, 'Lint the new files', 'Bash', 'Lint the new files', false, 2100),
  call(4, 'main', 'Orchestrator', 'TodoWrite', 'update todos', true, 200),
  call(5, SCOUT, 'scout', 'WebFetch', 'github.com/redis/ioredis#readme', true, 1800),
  call(6, DOCS, 'docs', 'mcp__github__create_issue', 'Add a Redis service to CI', true, 900),
  call(7, RESEARCHER, 'researcher', 'Grep', 'router\\.(get|post) in src', true, 900),
  call(8, RESEARCHER, 'researcher', 'Read', 'src/app.ts', true, 300),
  call(9, BUILDER, 'builder', 'Write', 'src/rateLimit.ts', true, 400),
  call(10, 'main', 'Orchestrator', 'Agent', 'Write the limiter', true, 1200),
  call(11, 'main', 'Orchestrator', 'Agent', 'Map the routes', true, 1100),
]

test('Recent activity: the newest ten tool calls of every agent, newest first, each who · verb · what, its outcome and age; a row opens its agent; none yet says so', () => {
  const p = page()
  p.load(sample(s => { s.activity = FEED }))
  const rows = () => find(p.view('ActivitySection()'), 'ra-row')
  assert.equal(rows().length, 10)
  assert.deepEqual(rows().map(r => flat(textOf(r))), [
    'builder ran Run the limiter tests waiting now',
    'Orchestrator asked you: Which store should back the limiter in production? waiting 1m',
    'Lint the new files ran Lint the new files failed 2m',
    'tester edited src/rateLimit.ts 250ms 3m',
    'Orchestrator updated its todos 200ms 4m',
    'scout fetched github.com/redis/ioredis#readme 1.8s 5m',
    'docs used mcp__github__create_issue on Add a Redis service to CI 900ms 6m',
    'researcher searched router\\.(get|post) in src 900ms 7m',
    'researcher read src/app.ts 300ms 8m',
    'builder wrote src/rateLimit.ts 400ms 9m',
  ])
  // a path in the mono face; a shell call's words (what it says it does) not
  assert.deepEqual(find(rows()[3], 'ra-target').map(t => t.p.class), ['ra-target mono'])
  assert.deepEqual(find(rows()[0], 'ra-target').map(t => t.p.class), ['ra-target'])
  click(rows()[5])
  assert.deepEqual({ ...p.run('route.drawer') }, { kind: 'agent', id: SCOUT })
  // a new call comes in at the top, the rest keep their rows
  p.load(sample(s => { s.now += MIN; s.activity = [call(-1, REVIEWER, 'reviewer', 'Read', 'src/rateLimit.ts', true, 120), ...FEED] }))
  assert.deepEqual(rows().slice(0, 2).map(r => r.k), ['toolu_feed-1', 'toolu_feed0'])
  // none yet, or a mod that writes none
  p.load(sample(s => { s.now += 2 * MIN; s.activity = [] }))
  assert.equal(p.text('ActivitySection()'), 'Recent activity No tool calls yet Every agent\'s tool calls show here as they happen.')
  p.load(sample(s => { s.now += 3 * MIN; delete s.activity }))
  assert.match(p.text('ActivitySection()'), /No tool calls yet/)
})

const OUTSIDE = 'C:\\Users\\sam\\AppData\\Local\\Temp\\bench.js'
const TOUCHED = [
  { path: 'src/rateLimit.ts', editors: [BUILDER, TESTER], added: 10, removed: 0, lastAt: NOW - 3 * MIN },
  { path: 'src/app.ts', editors: [BUILDER], added: 2, removed: 1, lastAt: NOW - 24 * MIN },
  ...Array.from({ length: 10 }, (_, i) => ({ path: `src/routes/r${i}.ts`, editors: [RESEARCHER], added: 1, removed: 1, lastAt: NOW - (30 + i) * MIN })),
  { path: OUTSIDE, editors: [BUILDER], added: 3, removed: 0, lastAt: NOW - 11 * MIN, isOutside: true },
]

test('Files: the repository`s ten edited last, each with its editors ("shared" by two or more), +/− and age; the rest a click away; those outside the repo one dim row; a file opens on Changes', () => {
  const p = page()
  p.load(sample(s => { s.files = TOUCHED }))
  const view = () => p.view('FilesSection()')
  const rows = () => find(view(), 'file-row')
  assert.match(flat(textOf(find(view(), 'sec-head')[0])), /^Files 12 Changes$/)
  assert.equal(rows().length, 10)
  assert.equal(flat(textOf(rows()[0])), 'src/ rateLimit.ts shared +10 −0 3m')
  assert.equal(find(rows()[0], 'stack-item').length, 2)
  assert.equal(flat(textOf(rows()[1])), 'src/ app.ts +2 −1 24m')
  assert.equal(find(rows()[1], 'tag').length, 0, 'one editor: not shared')
  assert.deepEqual(find(view(), 'outside-row').map(r => flat(textOf(r))), ['2 more files', '1 file outside the repo'])
  click(find(view(), 'outside-row')[0])
  assert.equal(rows().length, 12)
  click(find(view(), 'outside-row')[1])
  const out = rows()[12]
  assert.equal(flat(textOf(find(out, 'path')[0])), '…/Temp/ bench.js')
  assert.equal(find(out, 'path')[0].p.title, OUTSIDE)
  // a file opens on Changes, open there and brought into view: git's file, or the agents' other edit of one
  click(rows()[1])
  assert.equal(p.run('route.tab'), 'changes')
  assert.equal(p.run('ui.open.get("git|src/app.ts")'), true)
  assert.equal(p.run('ui.scrollTo.id'), 'file-src/app.ts')
  const app = find(p.view('ChangesPage()'), 'chg').find(c => c.k === 'src/app.ts')
  assert.ok(app.p.class.includes('open'))
  assert.equal(app.p.id, 'file-src/app.ts')
  p.run('navigate("now")')
  click(rows()[12])
  assert.equal(p.run(`ui.open.get(${JSON.stringify(`other|${OUTSIDE}`)})`), true)
  assert.equal(p.run('ui.open.get("outside|changes")'), true)
  assert.equal(find(p.view('ChangesPage()'), 'fgroup').find(g => g.k === OUTSIDE).p.id, `file-${OUTSIDE}`)
  // none yet, or a mod that writes none
  p.load(sample(s => { s.now += MIN; s.files = [] }))
  assert.equal(p.text('FilesSection()'), 'Files No files touched yet Files the agents edit show here, with who is on each.')
  p.load(sample(s => { s.now += 2 * MIN; delete s.files }))
  assert.match(p.text('FilesSection()'), /No files touched yet/)
})

test('the sample`s own figures, activity and files, as the mod`s builder writes them, read on the dashboard as they are', () => {
  const p = page()
  p.load(SAMPLE)
  assert.deepEqual(find(p.view('FiguresStrip()'), 'kpi').map(k => flat(textOf(k))), [
    '0 Agents running 2 waiting · 3 done · 1 failed · 1 stopped',
    '1/3 Plan done 2 to go',
    '≈$4.12 Spend at API prices 2.3M tokens · 40 min · context 41%',
    '4 Waiting on you Orchestrator asks: Which store should back the limiter in production?',
  ])
  const feed = find(p.view('ActivitySection()'), 'ra-row')
  assert.equal(feed.length, Math.min(10, SAMPLE.activity.length))
  assert.deepEqual(feed.map(r => r.k), SAMPLE.activity.slice(0, 10).map(x => x.id))
  assert.equal(flat(textOf(feed[0])), 'reviewer asked you: Which routes should skip the limiter? waiting 2m')
  // the newest ten hold three things builder and reviewer said between their calls; builder's force-push auto mode refused is older now (its mark, and the linter's failed call's, are checked below with the refused ones)
  assert.equal(feed.filter(r => r.p.class.includes('is-said')).length, 3)
  assert.equal(feed.filter(r => /denied/.test(textOf(r))).length, 0)
  const files = p.view('FilesSection()')
  assert.match(flat(textOf(find(files, 'sec-head')[0])), new RegExp(`^Files ${SAMPLE.files.filter(f => !f.isOutside).length} Changes$`))
  assert.equal(flat(textOf(find(files, 'file-row')[0])), 'src/ rateLimit.ts shared +7 −1 19m')
  assert.deepEqual(find(files, 'outside-row').map(r => flat(textOf(r))), ['1 file outside the repo'])
})

// ---- Org

test('Org`s list: the state`s rows in its order, each a status dot, its name, its call in flight verbatim and its time; a fold row opens on its members', () => {
  const p = page({ hash: '#/org' })
  p.load(SAMPLE)
  assert.equal(p.run('route.tab'), 'org')
  click(byText(p.view('OrgPage()'), 'seg-toggle', 'List').c.filter(Boolean)[1])
  assert.equal(p.run('ui.orgView'), 'list')
  assert.equal(p.storage['agent-deck:orgView'], '"list"')
  const rows = () => [...find(p.view('OrgPage()'), 'tree')[0].c].filter(Boolean)
  assert.deepEqual(rows().map(r => r.k), ['main', BUILDER, `fold:${BUILDER}`, REVIEWER, 'fold:main'])
  assert.deepEqual(rows().map(r => flat(textOf(r))), [
    'Orchestrator AskUserQuestion Which store should back the limiter in production? 12m',
    'builder Bash npm test -- rateLimit 29m',
    '1 done · 1 failed',
    'reviewer AskUserQuestion Which routes should skip the limiter? 8m',
    '2 done · 1 stopped',
  ])
  assert.deepEqual(rows().map(r => r.p.style['--d']), ['0', '1', '2', '1', '1'])
  // each row leads with its avatar, an image of the library's SVG with its status dot inside: the Orchestrator's amber, waiting on you
  const faces = findAll(rows()[0], v => v.t === 'img' && v.p.class === 'av')
  assert.equal(faces.length, 1)
  assert.ok(decodeURIComponent(faces[0].p.src.replace(/^data:image[/]svg[+]xml;charset=utf-8,/, '')).includes('cx="33" cy="33" r="6" fill="#f59e0b"'))
  // a fold opens on its members, each with its own last words; a description that is the title already says nothing
  click(rows()[2])
  click(rows().find(r => r.k === 'fold:main'))
  const byId = id => flat(textOf(rows().find(r => r.k === id)))
  assert.equal(byId('c4d7e8f9a0b1263d'), 'tester Done Wrote 6 tests in tests/rateLimit.test.ts ; all pass against the in-memory store. 10m')
  assert.equal(byId(LINT), 'Lint the new files Failed Run eslint on src/rateLimit.ts and src/app.ts and fix what it reports. 2m')
  assert.equal(byId('f1e2d3c4b5a6978c'), 'scout Stopped Check the Redis client options 3m')
  assert.deepEqual(rows().map(r => r.k), ['main', BUILDER, `fold:${BUILDER}`, 'c4d7e8f9a0b1263d', LINT, REVIEWER, 'fold:main', RESEARCHER, 'e5f6a7b8c9d0142b', 'f1e2d3c4b5a6978c'])
  // times at work run on with the clock; finished ones stand
  p.setNow(NOW + 5 * MIN)
  assert.match(byId('main'), / 17m$/)
  assert.match(byId(BUILDER), / 34m$/)
  assert.match(byId('c4d7e8f9a0b1263d'), / 10m$/)
  // a row opens its agent
  click(rows().find(r => r.k === BUILDER))
  assert.deepEqual({ ...p.run('route.drawer') }, { kind: 'agent', id: BUILDER })
  assert.equal(p.run('location.hash'), `#/org/agent/${BUILDER}`)
  assert.ok(rows().find(r => r.k === BUILDER).p.class.includes(' on'))
})

test('Org`s chart, by default (and 3): every agent row under the one that started it, counted above; it opens readable and the fit button shows it all; Now has no toggle', () => {
  const p = page()
  p.load(SAMPLE)
  assert.equal(find(p.view('NowPage()'), 'seg-toggle').length, 0)
  assert.equal(find(p.view('NowPage()'), 'org-view').length, 0)
  p.key('3')
  assert.equal(p.run('route.tab'), 'org')
  assert.equal(p.run('ui.orgView'), 'chart')
  const chart = p.view('OrgPage()')
  assert.equal(flat(textOf(find(chart, 'org-bar')[0])), '8 agents · 3 waiting on you · 1 failed · 1 stopped Chart List Timeline')
  assert.equal(find(chart, 'org-card').length, 8)
  assert.equal(find(chart, 'edge').length, 7)
  assert.match(flat(textOf(byText(chart, 'org-card', 'tester'))), /^tester general-purpose · 10m haiku-4\.5 · 76\.9k Wrote 6 tests/)
  click(byText(chart, 'org-card', 'docs'))
  assert.equal(p.run('route.drawer.id'), 'e5f6a7b8c9d0142b')
  // fitOf: as wide as the canvas allows, never under 85% nor over 100%, the Orchestrator at the top; 'all' fits it whole
  const fit = (w, h, vw, vh, mode) => p.run(`fitOf({ w: ${w}, h: ${h} }, ${vw}, ${vh}, '${mode}')`)
  const PAD = p.run('PAD')
  for (const [vw, vh] of [[701, 500], [637, 760]]) {
    const open = fit(768, 360, vw, vh, 'open')
    assert.ok(open.k >= 0.85 && open.k <= 1, `zoom ${open.k} at ${vw}`)
    assert.equal(Math.round(open.y + PAD * open.k), 24)
  }
  assert.equal(fit(1600, 900, 637, 760, 'open').k, 0.85)
  const all = fit(1600, 900, 637, 760, 'all')
  assert.ok(all.k < 0.85 && 1600 * all.k <= 637 - 32 + 1 && 900 * all.k <= 760 - 32 + 1)
  assert.equal(fit(400, 300, 1100, 760, 'open').k, 1)
})

test('Org`s Timeline, its third view (kept): a lane an agent from /timeline, in the tree`s order, each name a link to its drawer; its stretches, calls and outcome; the axis to now; a legend of only what it holds; a hover says what is under the pointer', async () => {
  const p = page({ hash: '#/org' })
  p.load(SAMPLE)
  click(byText(p.view('OrgPage()'), 'seg-toggle', 'Timeline').c.filter(Boolean)[2])
  assert.equal(p.run('ui.orgView'), 'timeline')
  assert.equal(p.storage['agent-deck:orgView'], '"timeline"')
  assert.match(flat(textOf(p.view('OrgPage()'))), /Reading the timeline…/)
  await settle()
  const timelines = () => p.calls.filter(one => one.url.startsWith('/timeline')).length
  assert.equal(timelines(), 1)
  const view = p.view('OrgPage()')
  assert.equal(flat(textOf(find(view, 'org-bar')[0])), '40m · 8 agents · 2 in the background Chart List Timeline')
  // the lanes, each name a link that opens its agent's drawer over Org
  assert.deepEqual(find(view, 'tl-name').map(a => flat(textOf(a))), ['Orchestrator', 'researcher', 'builder', 'tester', 'Lint the new files', 'docs', 'scout', 'reviewer'])
  assert.equal(find(view, 'tl-name')[2].p.href, `#/org/agent/${BUILDER}`)
  // the Orchestrator's three turns with idle between, waits on you, every outcome; the axis from 0m, its now line
  const svg = find(view, 'tl-svg')[0]
  assert.equal(find(svg, 'tl-work').length, 11)
  assert.equal(find(svg, 'tl-idle').length, 3)
  assert.equal(find(svg, 'tl-wait').length, 4)
  assert.deepEqual([find(svg, 'tl-done').length, find(svg, 'tl-failed').length, find(svg, 'tl-stopped').length], [3, 1, 1])
  assert.equal(find(svg, 'tl-you').length, 2)
  assert.equal(find(svg, 'tl-msg').length, 2)
  assert.deepEqual(find(view, 'tl-axis').map(t => flat(textOf(t))).slice(0, 2), ['0m', '5m'])
  assert.equal(find(view, 'tl-now').length, 1)
  assert.deepEqual(find(view, 'tl-key').map(k => flat(textOf(k))), ['working', 'waiting on you', 'idle', 'done', 'failed', 'stopped', 'you wrote', 'a tool call', 'started by', 'a message'])
  // a hover: what is under the pointer, from the drawing just made
  const at = (lane, minutes) => p.run(`(() => { const g = tl.geo; return tlWhat(g.L + ((g.right - g.L) * ${minutes} * 60000) / g.span, g.TOP + ${lane} * g.LANE + g.LANE / 2) })()`)
  assert.equal(at(3, 24.8)[0], 'Waiting on you: tester')
  assert.match(at(3, 24.8)[1], / · 1m$/)
  assert.equal(at(4, 23)[0], 'Failed: Lint the new files')
  // a call the deck still holds whole says what it was given; an older one its tool
  assert.equal(at(1, 8.6)[0], 'Read README.md')
  assert.match(at(1, 8.6)[1], / · 400ms$/)
  assert.equal(at(1, 5.2)[0], 'Glob')
  assert.match(at(0, 0)[0], /^You: Add per-user rate limiting/)
  assert.equal(at(0, 17)[0], 'Working: Orchestrator')
  assert.equal(at(0, 24)[0], 'Idle: Orchestrator')
  // the background tasks the deck saw start, under the agents: each its words and a bar from its call to now; a hover says what it is
  const svgOf = () => find(p.view('OrgPage()'), 'tl-svg')[0]
  assert.deepEqual(find(svgOf(), 'tl-bg-head').map(t => flat(textOf(t))), ['BACKGROUND'])
  assert.deepEqual(find(svgOf(), 'tl-bg-name').map(t => flat(textOf(t))), ['Start the dev server', 'CI checks on PR 42'])
  assert.equal(find(svgOf(), 'tl-bg').length, 2)
  const onBackground = (k, minutes) => p.run(`(() => { const g = tl.geo; return tlWhat(g.L + ((g.right - g.L) * ${minutes} * 60000) / g.span, g.bgTop + 16 + ${k} * g.LANE + g.LANE / 2) })()`)
  assert.equal(onBackground(0, 30)[0], 'Shell · npm run dev: Start the dev server')
  assert.match(onBackground(0, 30)[1], / – now · 18m$/)
  assert.equal(onBackground(1, 38)[0], 'Monitor: CI checks on PR 42')
  // read again once per state, not per drawing
  p.view('OrgPage()')
  p.load(SAMPLE)
  p.view('OrgPage()')
  assert.equal(timelines(), 1)
  p.load(sample(s => { s.now += 1000 }))
  p.view('OrgPage()')
  assert.equal(timelines(), 2)
  // a later page opens on the view picked last
  const again = page({ hash: '#/org', storage: p.storage })
  assert.equal(again.run('ui.orgView'), 'timeline')
})

test('the plan: every source Claude used, each as made (the board with owners, the todos, the approved plan as Markdown, a workflow`s phases with no status); none, no section', () => {
  const p = page()
  p.load(SAMPLE)
  const plan = p.view('PlanSection()')
  assert.deepEqual(find(plan, 'pcard-title').map(textOf), ['Task board', 'Todo list', 'Approved plan', 'Workflow · release-check'])
  assert.equal(flat(textOf(find(plan, 'pcard-board')[0])), 'Task board 1/3 Map the public routes researcher Write the sliding-window limiter Writing the limiter builder Review the limiter reviewer')
  assert.equal(flat(textOf(find(plan, 'pcard-todos')[0])), 'Todo list 2/4 Map the public routes Write the limiter and its stores Writing the limiter and its stores Answer 429 with Retry-After Update the docs')
  assert.deepEqual(find(find(plan, 'pcard-board')[0], 'glyph').map(g => g.p.class.split(' ')[1]), ['hue-done', 'hue-run', 'hue-idle'])
  // the approved plan as written: Markdown, never split into steps
  const approved = find(plan, 'pcard-approved')[0]
  assert.equal(find(approved, 'md').length, 1)
  assert.match(flat(textOf(approved)), /Rate limiting for the public API Map the routes\. Find every public route/)
  assert.equal(find(approved, 'item').length, 0)
  // phases, in order, with no glyph of any status
  const wf = find(plan, 'pcard-wf')[0]
  assert.equal(flat(textOf(wf)), 'Workflow · release-check started 5m ago Lint Unit tests Package')
  assert.equal(find(wf, 'glyph').length, 0)
  // an owner opens the agent of that name
  click(find(find(plan, 'pcard-board')[0], 'who-link')[1])
  assert.equal(p.run('route.drawer.id'), BUILDER)
  // only the sources Claude used
  p.load(sample(s => Object.assign(s.plan, { board: [], approved: null, workflows: [] })))
  assert.deepEqual(find(p.view('PlanSection()'), 'pcard-title').map(textOf), ['Todo list'])
  p.load(sample(s => { s.plan = null; if (s.figures) s.figures.plan = null }))
  assert.equal(p.view('PlanSection()'), null)
  assert.doesNotMatch(p.text('NowPage()'), /Plan/)
})

// ---- Chat

/** The chat's groups and notices, in order: a group's key is `g:` and its first message's key, a notice's its message's. */
const groupsIn = v => findAll(v, one => !!one.p && typeof one.p.class === 'string' && /^(cgroup|notice|cmp-line)( |$)/.test(one.p.class))
/** The keys of every message drawn: each bubble's, each hand-off's line (folded), each notice's, each compaction's line. */
const messageKeys = v => findAll(v, one => !!one.p && typeof one.p.class === 'string' && /^(brow|handoff|notice|cmp-line)( |$)/.test(one.p.class)).map(one => one.k)

test('Chat is a group chat: others` bubbles at the left under their avatar and name, "to X" with X`s small avatar; yours at the right in blue under "You"; one sender`s run stacks under one head, its hand-offs a line each; Claude Code`s notices in the middle', () => {
  const p = page({ hash: '#/chat' })
  p.load(SAMPLE)
  assert.equal(p.run('route.tab'), 'chat')
  const chat = () => p.view('ChatPage()')
  assert.equal(find(chat(), 'crow').length, 0, 'no sentence rows')
  // every message once, in the state's order
  assert.deepEqual(messageKeys(chat()), SAMPLE.chat.map(m => m.id))
  assert.equal(groupsIn(chat()).length, 24)
  const group = id => groupsIn(chat()).find(g => g.k === `g:${id}` || g.k === id)
  const head = id => flat(textOf(find(group(id), 'cg-head')[0]))
  // the Orchestrator's answer to you under its head (no "to you")
  const run = group('m1792011780000_main_you')
  assert.equal(run.p.class, 'cgroup theirs')
  assert.equal(head('m1792011780000_main_you'), 'Orchestrator 30m')
  assert.deepEqual(find(run, 'brow').map(b => b.k), ['m1792011780000_main_you'])
  assert.equal(findAll(find(run, 'cg-av')[0], v => v.t === 'img' && v.p.class === 'av').length, 1, 'the sender`s avatar')
  // its three hand-offs minutes after: a line each, one under the other, whom each went to and the start of its task, folded
  const handoffs = group('m1792011840000_main_b81c6f3e2a9d4c17')
  assert.equal(handoffs.p.class, 'cgroup handoffs')
  assert.deepEqual(find(handoffs, 'handoff').map(b => b.k), ['m1792011840000_main_b81c6f3e2a9d4c17', 'm1792012020000_main_e5f6a7b8c9d0142b', 'm1792012080000_main_f1e2d3c4b5a6978c'])
  assert.deepEqual(find(handoffs, 'handoff-who').map(t => flat(textOf(t))), ['Orchestrator → builder', 'Orchestrator → docs', 'Orchestrator → scout'])
  assert.match(flat(textOf(find(handoffs, 'handoff-gist')[0])), /^Write a sliding-window rate limiter in src\/rateLimit\.ts/)
  assert.equal(find(handoffs, 'bubble').length, 0)
  // a press opens one: its words in a bubble under its line; again, folded
  click(find(find(group('m1792011840000_main_b81c6f3e2a9d4c17'), 'handoff')[0], 'handoff-gist')[0])
  const opened = find(group('m1792011840000_main_b81c6f3e2a9d4c17'), 'handoff')[0]
  assert.equal(opened.p.class, 'handoff open')
  assert.match(flat(textOf(find(opened, 'bubble')[0])), /^Write a sliding-window rate limiter/)
  click(find(opened, 'handoff-fold')[0])
  assert.equal(find(find(group('m1792011840000_main_b81c6f3e2a9d4c17'), 'handoff')[0], 'bubble').length, 0)
  // a SendMessage: its summary bold over its words (Markdown), to an agent, that agent`s small avatar beside its name
  const sent = group('m1792013040000_b81c6f3e2a9d4c17_aa11bb22cc33dd44')
  assert.equal(head('m1792013040000_b81c6f3e2a9d4c17_aa11bb22cc33dd44'), 'builder to reviewer 9m')
  assert.equal(flat(textOf(find(sent, 'b-title')[0])), 'Limiter ready for review')
  assert.match(flat(textOf(find(sent, 'bubble')[0])), /^Limiter ready for review src\/rateLimit\.ts and both stores are in\./)
  assert.equal(find(sent, 'md').length, 1)
  assert.equal(findAll(find(sent, 'cg-to')[0], v => v.t === 'img' && v.p.class === 'av').length, 1)
  // words to nobody in particular: no "to"; a name no agent carries: words, not a link
  assert.equal(head('m1792013130000_b81c6f3e2a9d4c17_'), 'builder 7m')
  assert.equal(head('m1792013220000_b81c6f3e2a9d4c17_ops_bot'), 'builder to ops-bot 6m')
  assert.equal(find(find(group('m1792013220000_b81c6f3e2a9d4c17_ops_bot'), 'cg-to')[0], 'party-link').length, 0)
  // yours: at the right, "You", "to X" unless it went to the Orchestrator, in blue, plain
  const mine = group('m1792013340000_you_main')
  assert.equal(mine.p.class, 'cgroup mine')
  assert.equal(head('m1792013340000_you_main'), 'You 4m')
  assert.equal(head('m1792012620000_you_d2e3f4a5b6c7089a'), 'You to Lint the new files 16m')
  assert.equal(find(mine, 'b-plain').length, 1)
  assert.equal(find(mine, 'md').length, 0)
  // Claude Code's own: in the middle, small, the agent a notification is about named
  assert.deepEqual(find(chat(), 'notice').map(n => flat(textOf(n))), [
    'Claude Code Agent "Write the limiter tests" completed 12m',
    'Claude Code Claude needs your permission to use Bash builder 2m',
    'Claude Code The github MCP server is asking for your input 1m',
  ])
  // a question still held on you: edged amber, and the way to its card on the Dashboard
  const held = group('m1792013400000_main_you')
  assert.match(find(held, 'bubble')[0].p.class, /is-held/)
  click(byText(held, 'b-answer', 'Answer on Dashboard'))
  assert.equal(p.run('route.tab'), 'now')
  assert.deepEqual({ ...p.run('ui.scrollTo'), until: 0 }, { id: `need-${ASK_ONE}`, on: 'now', until: 0, focus: true })
})

test('a slash command you ran alone is a small line in the middle, "You ran /login", never a bubble of yours', () => {
  const p = page({ hash: '#/chat' })
  p.load(sample(s => s.chat.push({ id: 'mcmd', at: NOW - MIN, from: 'you', to: null, who: 'You', kind: 'command', text: '/login' })))
  const line = groupsIn(p.view('ChatPage()')).find(g => g.k === 'mcmd')
  assert.equal(line.p.class, 'notice notice-command')
  assert.equal(flat(textOf(line)), 'You ran /login 1m')
  assert.equal(find(p.view('ChatPage()'), 'cgroup').filter(g => flat(textOf(g)).includes('/login')).length, 0)
})

test('Clear finished on the page: its button sends clearFinished; a state that marks the cleared leaves them off the Dashboard, the members, Org and Everyone, with "Show 5 cleared", which sends showCleared', async () => {
  const p = page({ hash: '#/now' })
  p.load(SAMPLE)
  p.run('navigate("org")')
  assert.ok(byTextAll(p.view('OrgPage()'), 'researcher') > 0)
  p.run('navigate("now")')
  click(find(p.view('AgentsSection()'), 'fin-clear')[0])
  await settle()
  assert.deepEqual(p.commands().map(c => c.cmd), ['clearFinished'])
  assert.match(p.commands()[0].id, /^cl-/)
  // the mod's next state marks them (and counts its fold rows without them)
  const gone = [RESEARCHER, DOCS, SCOUT, TESTER, LINT]
  const isGone = m => gone.includes(m.from) || gone.includes(m.to) || gone.includes(m.agent)
  p.load(sample(s => {
    for (const r of s.agents) if (r.row === 'agent' && gone.includes(r.id)) r.isCleared = true
    s.agents = s.agents.filter(r => r.row !== 'fold')
    for (const m of s.chat) if (isGone(m)) m.isCleared = true
    s.cleared = { count: 5, at: NOW }
    s.now += 1000
  }))
  assert.deepEqual(find(p.view('AgentsSection()'), 'run-card').map(c => c.k), ['main', BUILDER, REVIEWER])
  assert.equal(find(p.view('AgentsSection()'), 'fin-fold').length, 0)
  assert.equal(flat(textOf(find(p.view('AgentsSection()'), 'fin-show')[0])), 'Show 5 cleared')
  assert.match(p.text('AgentsSection()'), /^Agents 3 /)
  // Chat: no member of them, nothing of theirs in Everyone; a drawer of one still opens
  p.run('navigate("chat")')
  assert.deepEqual(find(p.view('ChatPage()'), 'member').map(m => flat(textOf(find(m, 'member-name')[0]))), ['Everyone', 'Orchestrator', 'builder', 'reviewer'])
  const keys = messageKeys(p.view('ChatPage()'))
  for (const m of SAMPLE.chat) assert.equal(keys.includes(m.id), !isGone(m), m.id)
  p.open(`{ kind: "agent", id: "${TESTER}" }`)
  assert.match(p.text('Drawer()'), /tester/)
  p.run('closeDrawer()')
  // Org: none of them, and how many are cleared
  p.run('navigate("org")')
  assert.match(p.text('OrgPage()'), /^3 agents .*5 cleared/)
  for (const r of ['researcher', 'tester', 'scout']) assert.equal(byTextAll(p.view('OrgPage()'), r), 0, r)
  // Show 5 cleared
  p.run('navigate("now")')
  click(find(p.view('AgentsSection()'), 'fin-show')[0])
  await settle()
  assert.equal(p.commands().slice(-1)[0].cmd, 'showCleared')
})

/** How many elements under `v` read exactly `text`. */
const byTextAll = (v, text) => findAll(v, one => !!one.c && one.c.length === 1 && one.c[0] && one.c[0].t === '#' && one.c[0].s === text).length

test('every agent a message names opens its drawer: the sender`s avatar and name, the recipient in "to X", the agent a notice is about', () => {
  const p = page({ hash: '#/chat' })
  p.load(SAMPLE)
  const group = id => groupsIn(p.view('ChatPage()')).find(g => g.k === `g:${id}` || g.k === id)
  const sent = () => group('m1792013040000_b81c6f3e2a9d4c17_aa11bb22cc33dd44')
  click(find(sent(), 'cg-av')[0])
  assert.equal(p.run('route.drawer.id'), BUILDER)
  assert.equal(p.run('location.hash'), `#/chat/agent/${BUILDER}`)
  p.run('closeDrawer()')
  click(find(find(sent(), 'cg-name')[0], 'party-link')[0])
  assert.equal(p.run('route.drawer.id'), BUILDER)
  click(find(find(sent(), 'cg-to')[0], 'party-link')[0])
  assert.equal(p.run('route.drawer.id'), REVIEWER)
  // scout on the Orchestrator's hand-off to it
  click(find(find(group('m1792011840000_main_b81c6f3e2a9d4c17'), 'handoff')[2], 'party-link').slice(-1)[0])
  assert.equal(p.run('route.drawer.id'), SCOUT)
  // yours: the one it went to
  click(find(find(group('m1792012620000_you_d2e3f4a5b6c7089a'), 'cg-to')[0], 'party-link')[0])
  assert.equal(p.run('route.drawer.id'), LINT)
  // Claude Code's notice: the agent it is about
  click(find(group('m1792013436000_engine_you'), 'party-link')[0])
  assert.equal(p.run('route.drawer.id'), BUILDER)
  // you and Claude Code are no one to open
  assert.equal(find(find(group('m1792013340000_you_main'), 'cg-head')[0], 'party-link').length, 0)
})

test('Chat`s long messages fold to about six lines; a cut one loads /message/<id> once, the chat held where it is', async () => {
  const p = page({ hash: '#/chat' })
  p.load(SAMPLE)
  const cut = 'm1792011780000_main_you'
  const row = () => find(p.view('ChatPage()'), 'brow').find(b => b.k === cut)
  assert.ok(find(row(), 'b-words')[0].p.class.includes('folded'))
  click(byText(row(), 'b-more', 'Show more'))
  assert.equal(p.run('ui.holdChat'), true)
  assert.match(flat(textOf(row())), /Loading the rest…/)
  await settle()
  assert.match(flat(textOf(row())), /^Here is where things stand\..*Two things are open: which store backs production, and which routes skip the limiter\./)
  assert.ok(!find(row(), 'b-words')[0].p.class.includes('folded'))
  click(byText(row(), 'b-more', 'Show less'))
  click(byText(row(), 'b-more', 'Show more'))
  await settle()
  assert.deepEqual(p.fetched('message'), [`/message/${cut}`])
  // a short one has nothing to fold
  assert.equal(find(find(p.view('ChatPage()'), 'brow').find(b => b.k === 'm1792013130000_b81c6f3e2a9d4c17_'), 'b-more').length, 0)
})

test('Chat`s members replace the filter chips: Everyone, then each agent with its avatar, name and status dot, the finished behind "N finished ▸"; one picked shows your conversation with it and the composer sends to it; no key steps through them', async () => {
  const p = page({ hash: '#/chat' })
  p.load(SAMPLE)
  const members = () => find(p.view('ChatPage()'), 'member')
  const preview = words => ({ ...p.run(`previewOf('chat', ${JSON.stringify(words)})`) })
  const placeholder = () => find(p.view('Composer("chat")'), 'composer-input')[0].p.placeholder
  assert.equal(find(p.view('ChatPage()'), 'chip').length, 0)
  // those at work in front; the finished behind "5 finished ▸" at the end, which opens on them
  assert.deepEqual(members().map(m => flat(textOf(find(m, 'member-name')[0]))), ['Everyone', 'Orchestrator', 'builder', 'reviewer'])
  const fold = () => find(p.view('ChatPage()'), 'fin-fold')[0]
  assert.equal(flat(textOf(fold())), '5 finished ▸')
  assert.equal(find(find(p.view('ChatPage()'), 'members')[0], 'fin-clear').length, 1)
  click(fold())
  assert.deepEqual(members().map(m => flat(textOf(find(m, 'member-name')[0]))), ['Everyone', 'Orchestrator', 'builder', 'reviewer', 'tester', 'Lint the new files', 'researcher', 'docs', 'scout'])
  // each agent: its avatar, its name, its status dot in its status's hue
  for (const m of members().slice(1)) assert.equal(findAll(m, v => v.t === 'img' && v.p.class === 'av').length, 1)
  assert.deepEqual(members().slice(1).map(m => find(m, 'dot')[0].p.class), ['dot hue-wait', 'dot hue-wait', 'dot hue-wait', 'dot hue-done', 'dot hue-fail', 'dot hue-done', 'dot hue-done', 'dot hue-idle'])
  click(fold())
  // Everyone: every message, and the words go to the Orchestrator
  assert.ok(members()[0].p.class.includes(' on'))
  assert.equal(messageKeys(p.view('ChatPage()')).length, SAMPLE.chat.length)
  assert.equal(placeholder(), 'Message the Orchestrator, or @name an agent…')
  assert.deepEqual(preview('Ship it'), { text: '→ Orchestrator' })
  // builder: your conversation with it (all it said and was told, and Claude Code's word about it), and the words go to it
  click(members()[2])
  assert.equal(p.run('ui.chatFilter'), BUILDER)
  assert.equal(p.run('ui.pinChat'), true)
  assert.ok(members()[2].p.class.includes(' on'))
  assert.ok(!members()[0].p.class.includes(' on'))
  const shown = messageKeys(p.view('ChatPage()'))
  assert.equal(shown.length, 10)
  for (const id of ['m1792013100000_you_b81c6f3e2a9d4c17', 'm1792013130000_b81c6f3e2a9d4c17_', 'm1792013436000_engine_you', 'm1792013220000_b81c6f3e2a9d4c17_ops_bot']) assert.ok(shown.includes(id), id)
  assert.equal(placeholder(), 'Message builder…')
  assert.deepEqual(preview(''), { text: 'To builder · @name for another agent', hint: true })
  assert.deepEqual(preview('Keep going'), { text: '→ builder via SendMessage' })
  p.run('ui.drafts.set("chat", "Keep the store optional.")')
  await p.run('sendChat("chat")')
  const [cmd] = p.commands()
  assert.deepEqual(cmd, { cmd: 'chat', id: cmd.id, agentId: BUILDER, text: 'Keep the store optional.' })
  assert.deepEqual(messageKeys(p.view('ChatPage()')).slice(-1), [`out:${cmd.id}`])
  // an @name still goes where it says
  p.run('ui.drafts.set("chat", "@reviewer Look again.")')
  await p.run('sendChat("chat")')
  assert.equal(p.commands()[1].agentId, REVIEWER)
  // the Orchestrator picked: its conversation, the words to it as ever
  click(members()[1])
  assert.equal(placeholder(), 'Message the Orchestrator…')
  assert.deepEqual(preview('Ship it'), { text: '→ Orchestrator' })
  // Everyone again: the Orchestrator; under its name, how many are at work
  click(members()[0])
  assert.equal(p.run('ui.chatFilter'), 'all')
  assert.equal(p.run('recipientOf("Ship it", filterOf()).agentId'), 'main')
  assert.equal(flat(textOf(find(members()[0], 'member-sub')[0])), 'every message')
  p.load(sample(s => { s.now += 1000; s.figures.running = 2 }))
  assert.equal(flat(textOf(find(members()[0], 'member-sub')[0])), '2 at work')
  assert.equal(flat(textOf(find(members()[2], 'member-sub')[0])), 'waiting on you')
  // no key cycles the members: f is no key of the page's
  p.run('navigate("now")')
  assert.equal(p.key('f'), false)
  assert.equal(p.run('route.tab'), 'now')
  assert.equal(p.run('ui.chatFilter'), 'all')
  // one gone from the session reads as Everyone
  p.run('ui.chatFilter = "gone"')
  assert.ok(members()[0].p.class.includes(' on'))
  assert.equal(p.run('recipientOf("hi", filterOf()).agentId'), 'main')
  // the drawer's "Chat with": that member picked, no @ typed for it
  p.open(`{ kind: "agent", id: "${TESTER}" }`)
  click(byText(p.view('Drawer()'), 'btn', 'Chat with tester'))
  assert.equal(p.run('route.tab'), 'chat')
  assert.equal(p.run('filterOf()'), TESTER)
  assert.ok(find(p.view('ChatPage()'), 'member').find(m => m.k === TESTER).p.class.includes(' on'))
  assert.equal(placeholder(), 'Message tester…')
  assert.doesNotMatch(p.run('ui.drafts.get("chat") || ""'), /@/)
})

const NATIVE = 'n1a2b3c4d5e6f708', SHELL = 'n2b3c4d5e6f70819', BUILD = 'b0b1b2b3b4b5b6b7', W1 = 'w1aaaaaaaaaaaaaa', W2 = 'w2bbbbbbbbbbbbbb'
/** The sample with agents to @name: a running "Native Chat as a group chat" (no name: its title is its description), a newer finished "Native shell", an older finished "build", and two "worker"s started at once, both at work. */
const crowd = () => sample(s => {
  const row = (id, status, title, name, startedAt) => ({ row: 'agent', id, parent: 'main', depth: 1, kind: 'agent', status, name, description: title, title, shortId: id.slice(0, 7), startedAt, todos: [] })
  s.agents.push(
    row(NATIVE, 'running', 'Native Chat as a group chat', '', NOW - 6 * MIN),
    row(SHELL, 'done', 'Native shell', '', NOW - 3 * MIN),
    row(BUILD, 'done', 'build', 'build', NOW - 40 * MIN),
    row(W1, 'running', 'worker', 'worker', NOW - 2 * MIN),
    row(W2, 'running', 'worker', 'worker', NOW - 2 * MIN),
  )
})

test('@name is forgiving, as W.recipientOf is: names read lowercase in a–z and 0–9; an exact id or short id, then an exact name, one that starts with it, one that holds it, one that holds every word of it; those at work or waiting first, then the newest; a tie asks "Did you mean"', async () => {
  const p = page({ hash: '#/chat' })
  p.load(crowd())
  const to = words => { const r = p.run(`recipientOf(${JSON.stringify(words)})`); return r.error ? r.error : `${r.agentId}: ${r.text}` }
  assert.equal(p.run('normName("Native Chat — as a Group-chat!")'), 'nativechatasagroupchat')
  assert.deepEqual([...p.run('handleWords("NativeChat")')], ['native', 'chat'])
  // the owner's: @NativeChat finds "Native Chat as a group chat"
  assert.equal(to('@NativeChat hi'), `${NATIVE}: hi`)
  assert.equal(to('@native-chat hi'), `${NATIVE}: hi`)
  // 1. an exact id or short id, any case
  assert.equal(to('@b81c6f3 hi'), `${BUILDER}: hi`)
  assert.equal(to('@B81C6F3E2A9D4C17 hi'), `${BUILDER}: hi`)
  // 2. an exact name before a longer one that starts with it, at work or not
  assert.equal(to('@build hi'), `${BUILD}: hi`)
  assert.equal(to('@Build-er hi'), `${BUILDER}: hi`)
  // 3. a name that starts with it: the one at work before the newer one done
  assert.equal(to('@native hi'), `${NATIVE}: hi`)
  assert.equal(to('@re hi'), `${REVIEWER}: hi`)
  // 4. a name that holds it: in the sample, of builder and reviewer (waiting on you), tester and researcher (done), the newest of those waiting
  const base = page({ hash: '#/chat' })
  base.load(SAMPLE)
  assert.equal(base.run('recipientOf("@er hi").agentId'), REVIEWER)
  assert.equal(to('@newfiles hi'), `${LINT}: hi`)
  // 5. a name that holds every word of it, in any order
  assert.equal(to('@files-new hi'), `${LINT}: hi`)
  assert.equal(to('@ChatNative hi'), `${NATIVE}: hi`)
  assert.equal(to('@group_native hi'), `${NATIVE}: hi`)
  // none; never the Orchestrator (words with no @ go to it)
  assert.equal(to('@zz hi'), 'No agent named @zz in this session')
  assert.equal(to('@orchestrator hi'), 'No agent named @orchestrator in this session')
  // a tie: as much at work, started at once; in W.recipientOf's words, each by the handle that names it alone
  const tie = p.run('recipientOf("@worker go on")')
  assert.equal(tie.error, 'Did you mean: worker (@w1aaaaa) or worker (@w2bbbbb)?')
  assert.deepEqual(tie.choices.map(r => r.id), [W1, W2], 'in the state`s order')
  // four at most, then how many more
  const many = page({ hash: '#/chat' })
  many.load(sample(s => { for (let i = 0; i < 6; i++) s.agents.push({ ...crowd().agents.at(-1), id: `w${i}cccccccccccccc`, shortId: `w${i}ccccc` }) }))
  assert.equal(many.run('recipientOf("@worker go").error'), 'Did you mean: worker (@w0ccccc), worker (@w1ccccc), worker (@w2ccccc), worker (@w3ccccc), or 2 more?')
  // one of them done: the other, no question
  const one = page({ hash: '#/chat' })
  one.load(sample(s => { crowd().agents.slice(-2).forEach((r, i) => s.agents.push({ ...r, status: i ? 'done' : 'running' })) }))
  assert.equal(one.run('recipientOf("@worker go on").agentId'), W1)

  // the composer: the foot says where it goes; a tie offers each as a name to click, which @names that one alone
  const preview = words => ({ ...p.run(`previewOf('chat', ${JSON.stringify(words)})`) })
  assert.deepEqual(preview('@NativeChat hi'), { text: '→ Native Chat as a group chat via SendMessage' })
  p.run('ui.drafts.set("chat", "@worker go on")')
  const foot = () => find(p.view('Composer("chat")'), 'composer-foot')[0]
  assert.match(flat(textOf(foot())), /^Did you mean: worker @w1aaaaa worker @w2bbbbb Enter sends/)
  await p.run('sendChat("chat")')
  assert.equal(p.commands().length, 0, 'a tie sends nothing')
  click(find(foot(), 'choice')[1])
  assert.equal(p.run('ui.drafts.get("chat")'), '@w2bbbbb go on')
  assert.deepEqual(preview('@w2bbbbb go on'), { text: '→ worker via SendMessage' })
  await p.run('sendChat("chat")')
  assert.deepEqual(p.commands().map(c => [c.agentId, c.text]), [[W2, 'go on']])
  // typing an @name: the agents it can be, best first; a pick @names it alone
  p.run('ui.drafts.set("chat", "@nat")')
  assert.deepEqual(find(p.view('Composer("chat")'), 'pick-handle').map(textOf), [`@${NATIVE.slice(0, 7)}`, `@${SHELL.slice(0, 7)}`])
  p.run('ui.drafts.set("chat", "@wor")')
  click(find(p.view('Composer("chat")'), 'pick')[0])
  assert.match(p.run('ui.drafts.get("chat")'), /^@w[12][ab]{5} $/)
})

test('the composer: no @ goes to the member picked (Everyone: the Orchestrator), @name to that agent by SendMessage; the preview says where, the ack what came of it', async () => {
  const p = page({ hash: '#/chat' })
  p.load(SAMPLE)
  const to = words => p.run(`recipientOf(${JSON.stringify(words)})`)
  assert.deepEqual({ ...to('  And the changelog?  ') }, { agentId: 'main', title: 'Orchestrator', text: 'And the changelog?' })
  assert.deepEqual({ ...to('@BUILDER keep it\noptional') }, { agentId: BUILDER, title: 'builder', text: 'keep it\noptional' })
  assert.deepEqual({ ...to('@d2e3f4a use the repo config') }, { agentId: LINT, title: 'Lint the new files', text: 'use the repo config' })
  assert.deepEqual({ ...to('@nobody hi') }, { error: 'No agent named @nobody in this session' })
  assert.deepEqual({ ...to('@builder   ') }, { error: 'Nothing to send' })
  assert.deepEqual({ ...to('   ') }, { error: 'Nothing to send' })
  const preview = words => ({ ...p.run(`previewOf('chat', ${JSON.stringify(words)})`) })
  assert.deepEqual(preview(''), { text: 'To the Orchestrator · @name for one of its agents', hint: true })
  assert.deepEqual(preview('@'), { text: 'Type the agent\'s name', hint: true })
  assert.deepEqual(preview('Ship it'), { text: '→ Orchestrator' })
  assert.deepEqual(preview('@researcher what did you find?'), { text: '→ researcher via SendMessage' })
  assert.deepEqual(preview('@re'), { text: '→ reviewer via SendMessage' })
  assert.deepEqual(preview('@zz hi'), { text: 'No agent named @zz in this session', err: true })
  // typing an @name: the agents it can be, picked by a click or Tab
  p.run('ui.drafts.set("chat", "@re")')
  assert.deepEqual(find(p.view('Composer("chat")'), 'pick-handle').map(textOf), ['@reviewer', '@researcher'])
  click(find(p.view('Composer("chat")'), 'pick')[1])
  assert.equal(p.run('ui.drafts.get("chat")'), '@researcher ')

  // a send: the command, the bubble it shows as at once, then what its ack says
  p.run('ui.drafts.set("chat", "@builder Keep the Redis store optional.")')
  await p.run('sendChat("chat")')
  const [cmd] = p.commands()
  assert.deepEqual(cmd, { cmd: 'chat', id: cmd.id, agentId: BUILDER, text: 'Keep the Redis store optional.' })
  assert.equal(p.run('ui.drafts.has("chat")'), false, 'the box is cleared')
  const mine = () => groupsIn(p.view('ChatPage()')).find(g => g.k === `g:out:${cmd.id}`)
  assert.equal(mine().p.class, 'cgroup mine')
  assert.equal(flat(textOf(mine())), 'You to builder now Keep the Redis store optional. Sending…')
  p.load(sample(s => {
    s.chat.push({ id: 'm-mine', at: NOW, from: 'you', to: BUILDER, who: 'You → builder', kind: 'chat', text: 'Keep the Redis store optional.', ackId: cmd.id })
    s.acks.push({ id: cmd.id, ok: true, status: 'delivered', text: 'It reads it at its next step', at: NOW })
  }))
  assert.equal(flat(textOf(mine())), 'You to builder now Keep the Redis store optional. Delivered: it reads it at its next step')
  assert.equal(find(p.view('ChatPage()'), 'brow').filter(b => /Keep the Redis store optional\./.test(textOf(b)) && b.k !== 'm1792013100000_you_b81c6f3e2a9d4c17').length, 1, 'one bubble, its key kept')
  // none comes: after a while the page says so
  p.run('ui.drafts.set("chat", "Anyone there?")')
  await p.run('sendChat("chat")')
  p.setNow(NOW + 21_000)
  assert.match(flat(textOf(find(p.view('ChatPage()'), 'brow').pop())), /Sent, but Claude Code hasn't confirmed it/)
  // a name no agent carries is refused before it goes
  p.run('ui.drafts.set("chat", "@ops-bot hello")')
  await p.run('sendChat("chat")')
  assert.equal(p.commands().length, 2)
  assert.match(p.text('Composer("chat")'), /No agent named @ops-bot in this session/)
})

test('the sample`s acks show under the bubbles they name, while they matter: refused, queued; a delivered one is old news once its agent spoke after it', () => {
  const p = page({ hash: '#/chat' })
  p.load(SAMPLE)
  const note = id => { const b = find(p.view('ChatPage()'), 'brow').find(one => one.k === id); return find(b, 'b-note').map(n => flat(textOf(n))) }
  assert.deepEqual(note('m1792012620000_you_d2e3f4a5b6c7089a'), ['Not delivered: it has ended'])
  assert.deepEqual(note('m1792013340000_you_main'), ['Queued: Claude reads it when it finishes its current turn'])
  assert.deepEqual(note('m1792013100000_you_b81c6f3e2a9d4c17'), [])
  // this build's word on Stop: as the mod words it
  assert.equal(p.run('ackState({ ok: false, status: "failed", text: "Not in this build yet: press Esc in Claude Code" }).text'), 'Not in this build yet: press Esc in Claude Code')
})

// ---- Changes

test('Changes: git`s files, each opening on git`s own diff and the agents` own patches of it; the other edits, those outside the repo folded; commits; Review asks first', async () => {
  const p = page({ hash: '#/changes' })
  p.load(SAMPLE)
  const view = () => p.view('ChangesPage()')
  const files = SAMPLE.changes.files
  const add = files.reduce((t, f) => t + f.added, 0), rem = files.reduce((t, f) => t + f.removed, 0)
  assert.match(flat(textOf(view())), new RegExp(`^${files.length} uncommitted files \\+${add} −${rem} feat/rate-limit ↑1 · 9c1e4b7 · acme-api Ask for review Uncommitted ${files.length}`))
  assert.deepEqual(find(view(), 'chg').map(c => c.k), files.map(f => f.path))
  const chg = path => find(view(), 'chg').find(c => c.k === path)
  click(find(chg('src/app.ts'), 'chg-head')[0])
  const app = () => chg('src/app.ts')
  assert.match(flat(textOf(app())), /^M src\/ app\.ts \+2 −1 Git's diff against HEAD/)
  assert.match(flat(textOf(app())), /The agent edit of this file Edit builder 24m ago \+2 −1/)
  await settle()
  assert.deepEqual(p.fetched('patch'), ['/patch/toolu_01BldE1'])
  assert.deepEqual(p.fetched('gitdiff'), [`/gitdiff/${files.find(f => f.path === 'src/app.ts').diffId}`])
  // git's diff first, the agent's own patch beside it: never one read as the other
  const [git, own] = find(app(), 'chg-part')
  assert.deepEqual(find(git, 'dl').map(l => l.p.class), ['dl dl-hunk', 'dl dl-ctx', 'dl dl-add', 'dl dl-ctx', 'dl dl-del', 'dl dl-add'])
  assert.deepEqual(find(own, 'dl').map(l => l.p.class), ['dl dl-hunk', 'dl dl-ctx', 'dl dl-add', 'dl dl-ctx', 'dl dl-del', 'dl dl-add'])
  assert.equal(find(git, 'edit').length, 0)
  click(find(chg('package.json'), 'chg-head')[0])
  assert.match(flat(textOf(chg('package.json'))), /No agent edited this file in this session\.$/)
  // the agents' edits git does not list: here only one outside the repository, in its dim row
  const other = () => find(view(), 'sec').find(s => /^Other agent edits/.test(flat(textOf(find(s, 'sec-title')[0]))))
  assert.equal(flat(textOf(find(other(), 'sec-title')[0])), 'Other agent edits')
  click(find(other(), 'outside-row')[0])
  assert.equal(find(other(), 'path')[0].p.title, 'C:\\Users\\sam\\AppData\\Local\\Temp\\bench.js')
  assert.equal(flat(textOf(find(other(), 'path')[0])), '…/Temp/ bench.js')
  assert.equal(flat(textOf(find(view(), 'commit')[0])), '9c1e4b7 Add the sliding-window limiter builder 1 file +6 −0 15m')
  // Review: nothing goes before you say yes
  const review = () => p.view(`ReviewButton('changes', 'Review the diff')`)
  click(byText(review(), 'btn', 'Ask for review'))
  assert.equal(p.commands().length, 0)
  assert.equal(flat(textOf(find(review(), 'confirm')[0])), 'Ask Claude to review these changes? It runs when Claude is free. Cancel Ask Claude')
  click(byText(review(), 'btn', 'Ask Claude'))
  await settle()
  const [cmd] = p.commands()
  assert.deepEqual(cmd, { cmd: 'review', id: cmd.id, text: 'Review the diff' })
  p.load(sample(s => s.acks.push({ id: cmd.id, ok: true, status: 'queued', text: 'Claude reviews it when it finishes its current turn', at: NOW })))
  assert.equal(flat(textOf(find(review(), 'confirm-note')[0])), 'Queued: Claude reviews it when it finishes its current turn')
})

test('Changes: git`s diff comes from /gitdiff/<diffId>, fetched again when the id moves; an untracked file`s is its whole text; with none, the page says why; one not on disk can be retried', async () => {
  const p = page({ hash: '#/changes' })
  p.load(SAMPLE)
  const first = SAMPLE.changes.files.find(f => f.path === 'package.json').diffId
  p.run('ui.open.set("git|package.json", true)')
  const row = () => find(p.view('ChangesPage()'), 'chg').find(c => c.k === 'package.json')
  assert.match(flat(textOf(row())), /Git's diff against HEAD/)
  await settle()
  assert.deepEqual(p.fetched('gitdiff'), [`/gitdiff/${first}`])
  const git = () => find(row(), 'chg-part')[0]
  assert.deepEqual(find(git(), 'dl').map(l => l.p.class.slice(6)), ['hunk', 'ctx', 'ctx', 'add', 'ctx', 'ctx'])
  assert.match(flat(textOf(git())), /10 \+ "ioredis": "\^5\.4\.1",/)
  // drawn again from what it fetched: no second fetch
  row()
  await settle()
  assert.equal(p.fetched('gitdiff').length, 1)
  // the file changed: its diff has another id, fetched afresh
  const moved = SAMPLE.changes.files.find(f => f.path === 'docs/api.md').diffId
  p.load(sample(s => { s.now += 1000; s.changes.files.find(f => f.path === 'package.json').diffId = moved }))
  row()
  await settle()
  assert.deepEqual(p.fetched('gitdiff'), [`/gitdiff/${first}`, `/gitdiff/${moved}`])
  assert.match(flat(textOf(git())), /Each user may make 100 requests a minute/)
  // untracked (git's ??, the mod's N), not read yet: why there is none, and no fetch
  p.load(sample(s => { s.now += 2000; Object.assign(s.changes.files.find(f => f.path === 'package.json'), { code: 'N', diffId: null }) }))
  assert.equal(flat(textOf(git())), 'Git\'s diff untracked: its whole text Git\'s diff of this file is not here: not read yet, a binary file, or too long to show.')
  assert.equal(p.fetched('gitdiff').length, 2)
  // an id with no file on disk: the error, and Retry fetches it again
  p.load(sample(s => { s.now += 3000; s.changes.files.find(f => f.path === 'package.json').diffId = 'gone-1-1' }))
  row()
  await settle()
  assert.match(flat(textOf(git())), /Git's diff is not on disk yet\. Retry$/)
  click(byText(git(), 'btn', 'Retry'))
  row()
  await settle()
  assert.deepEqual(p.fetched('gitdiff').slice(-2), ['/gitdiff/gone-1-1', '/gitdiff/gone-1-1'])
})

test('Changes with no repository: it says where the chat runs and what Changes follows, offers the repositories inside its folder (a press sends selectRepo), and the agents` edits by file, the one edited last first and open; pinned, "pinned" and Follow the work', async () => {
  const where = { cwd: 'C:\\Users\\sam\\Documents', name: 'Documents', isRepo: false, pinned: '', picks: [{ name: 'agent-deck', root: 'C:/Users/sam/Documents/agent-deck' }, { name: 'notes-app', root: 'C:/Users/sam/Documents/notes-app' }] }
  // as the mod writes it with no repository: every path absolute, none outside it, no git files or commits
  const noRepo = s => {
    s.changes = { repo: null, where, files: [], commits: [], edits: s.changes.edits.map(({ isOutside, ...e }) => ({ ...e, path: /^[A-Za-z]:/.test(e.path) ? e.path : `C:/Users/sam/code/acme-api/${e.path}` })) }
  }
  const p = page({ hash: '#/changes' })
  p.load(sample(noRepo))
  const view = () => p.view('ChangesPage()')
  assert.equal(flat(textOf(find(view(), 'chg-sum')[0])), 'No repository This chat runs in Documents, which isn’t a git repository. Changes follows the repository an agent edits in; the edits agents made outside one are below, exact.')
  const picks = () => find(view(), 'chg-pick')
  assert.equal(flat(textOf(find(view(), 'sec-picks')[0].c[0])), 'Repositories in Documents 2')
  assert.deepEqual(picks().map(b => flat(textOf(b))), ['agent-deck', 'notes-app'])
  assert.equal(picks()[0].p.title, 'C:/Users/sam/Documents/agent-deck')
  click(picks()[0])
  await settle()
  const [sent] = p.commands()
  assert.deepEqual(sent, { cmd: 'selectRepo', id: sent.id, root: 'C:/Users/sam/Documents/agent-deck' })
  // the agents' edits by file, the one edited last first, the newest open with its patch, the rest shut
  const groups = () => find(view(), 'fgroup')
  assert.deepEqual(groups().map(g => g.k), ['C:\\Users\\sam\\AppData\\Local\\Temp\\bench.js', 'C:/Users/sam/code/acme-api/src/rateLimit.ts', 'C:/Users/sam/code/acme-api/tests/rateLimit.test.ts', 'C:/Users/sam/code/acme-api/docs/api.md', 'C:/Users/sam/code/acme-api/src/app.ts'])
  assert.deepEqual(groups().map(g => g.p.class.includes('open')), [true, false, false, false, false])
  assert.match(flat(textOf(groups()[0])), /1 edit \+3 −0 Write builder 11m ago/)
  assert.match(flat(textOf(groups()[1])), /2 edits \+7 −1$/)
  // a later edit opens nothing by itself: what is open stays
  p.load(sample(s => { noRepo(s); s.now += 1000; s.changes.edits.push({ id: 'toolu_01Late', agent: BUILDER, tool: 'Edit', path: 'C:/Users/sam/code/acme-api/README.md', at: s.now, added: 1, removed: 0 }) }))
  assert.deepEqual(groups().map(g => [g.k.split(/[\\/]/).pop(), g.p.class.includes('open')]).slice(0, 2), [['README.md', false], ['bench.js', true]])
  // pinned: the usual git view, "pinned", and Follow the work, which sends the empty root
  p.load(sample(s => { s.now += 2000; s.changes.where = { ...where, pinned: s.changes.repo.root } }))
  assert.match(flat(textOf(find(view(), 'chg-repo')[0])), /· acme-api · pinned$/)
  assert.equal(picks().length, 0)
  click(byText(view(), 'chg-follow', 'Follow the work'))
  await settle()
  assert.deepEqual(p.commands().at(-1), { cmd: 'selectRepo', id: p.commands().at(-1).id, root: '' })
  // the chat's own repository: no picks, no Follow the work
  p.load(sample(s => { s.now += 3000 }))
  assert.equal(picks().length, 0)
  assert.equal(find(view(), 'chg-follow').length, 0)
  // another session's deck, viewed: read-only, its picks and Follow the work go nowhere from here
  const other = page({ hash: '#/s/other-1/changes' })
  assert.equal(other.run('route.session'), 'other-1')
  assert.equal(await other.run("command({ cmd: 'selectRepo', root: '' }).then(() => 'sent', e => e.message)"), 'Read-only here: this is another session\'s deck. Do that in its window.')
  assert.equal(other.commands().length, 0)
})

// ---- the drawers

test('the agent drawer: its task, live call, result and todos; Activity from /agent/<fileId>, every call opening on all of it; its edits; Chat with it; Message', async () => {
  const p = page({ hash: `#/now/agent/${BUILDER}` })
  p.load(SAMPLE)
  assert.deepEqual({ ...p.run('route.drawer') }, { kind: 'agent', id: BUILDER })
  const drawer = () => p.view('Drawer()')
  assert.match(flat(textOf(drawer())), /^builder general-purpose · sonnet-4\.5 · background waiting on you 29m started by Orchestrator 513k tokens b81c6f3 Message Chat with builder Stop builder needs permission Bash 2m npm test -- rateLimit/)
  // the need above shows its call in flight already: no second line of it
  assert.equal(find(drawer(), 'live').length, 0)
  assert.match(flat(textOf(drawer())), /Task Write a sliding-window rate limiter in src\/rateLimit\.ts/)
  assert.deepEqual(p.fetched('agent'), [`/agent/${BUILDER}`])
  await settle()
  const acts = () => find(drawer(), 'act')
  assert.deepEqual(acts().map(a => flat(textOf(find(a, 'act-head')[0]))), [
    'Bash Run the limiter tests waiting 2m',
    'Write C:/Users/sam/AppData/Local/Temp/bench.js 200ms 11m',
    'Bash Push the limiter failed 13m',
    'Edit src/app.ts 300ms 24m',
    'Write src/rateLimit.ts 400ms 27m',
  ])
  click(find(acts()[0], 'act-head')[0])
  assert.match(flat(textOf(acts()[0])), /npm test -- rateLimit toolu_01BldB2 · no result yet/)
  click(find(acts()[3], 'act-head')[0])
  await settle()
  assert.ok(find(acts()[3], 'dl-add').length > 0, 'an edit opens on its patch')
  assert.match(flat(textOf(drawer())), /Edits 3 files src\/ rateLimit\.ts 1 edit \+6 −0/)
  assert.match(flat(textOf(drawer())), /→ builder via SendMessage/)
  // the file is fetched again only when the row changes
  p.load(SAMPLE)
  drawer()
  assert.equal(p.fetched('agent').length, 1)
  p.load(sample(s => { s.now += 1000; s.agents[1].tokens += 900 }))
  drawer()
  assert.equal(p.fetched('agent').length, 2)
  // Message: its own composer, its words to this agent with no @ needed
  click(byText(drawer(), 'btn', 'Message'))
  assert.equal(p.run('ui.focusTo'), `composer-${BUILDER}`)
  p.run(`ui.drafts.set("agent:${BUILDER}", "Run them with --runInBand.")`)
  await p.run(`sendChat("agent:${BUILDER}")`)
  assert.deepEqual(p.commands().pop(), { cmd: 'chat', id: p.commands().pop().id, agentId: BUILDER, text: 'Run them with --runInBand.' })
  assert.match(flat(textOf(find(drawer(), 'composer-foot')[0])), /Sending…/)
  // Chat with it: the chat, filtered to it
  click(byText(drawer(), 'btn', 'Chat with builder'))
  assert.equal(p.run('route.tab'), 'chat')
  assert.equal(p.run('ui.chatFilter'), BUILDER)

  // the Orchestrator: its latest answer whole from its file, its todos, its needs
  p.open('{ kind: "agent", id: "main" }')
  drawer()
  await settle()
  const main = flat(textOf(drawer()))
  assert.match(main, /Orchestrator main loop · opus-5\.5/)
  assert.match(main, /Todos 2\/4 Map the public routes Write the limiter and its stores Writing the limiter and its stores/)
  assert.match(main, /Latest answer .*Two things are open: which store backs production/)
  assert.doesNotMatch(main, /Task /)
  // a running agent with nothing held on you: its call in flight
  p.load(sample(s => { s.now += 2000; s.needs = s.needs.filter(n => n.agent !== BUILDER); Object.assign(s.agents[1], { status: 'running', needs: 0 }) }))
  p.open(`{ kind: "agent", id: "${BUILDER}" }`)
  assert.equal(flat(textOf(find(drawer(), 'live')[0])), 'Now Bash npm test -- rateLimit 2m')
  // a link to an agent no longer in the session
  p.open('{ kind: "agent", id: "gone" }')
  assert.match(flat(textOf(drawer())), /This agent is not in the session/)
})

test('Inspect (5, #/inspect): Context, Permissions, Loaded and Spend, as the state holds them, each folding to its head and one line; the header keeps no Inspect or Keys button, and no key badge', () => {
  const p = page()
  p.load(SAMPLE)
  const header = p.view('Header()')
  assert.equal(find(header, 'icon-btn').length, 0)
  assert.equal(findAll(header, v => v.t === 'kbd' || (v.p && v.p.title && /\(\d\)|\([a-z]\)/.test(v.p.title))).length, 0)
  assert.equal(p.key('5'), true)
  assert.equal(p.run('route.tab'), 'inspect')
  assert.equal(p.run('location.hash'), '#/inspect')
  assert.ok(find(p.view('Header()'), 'tab')[4].p.class.includes(' on'))
  assert.deepEqual(find(p.view('Page()'), 'sec-title').map(t => flat(textOf(t))), ['Context', 'Permissions 7', 'Loaded', 'Spend'])
  // Context: its size and share, a bar of /context's rows (those in the window), each row, then the compactions
  const ctx = p.text('ContextSection()')
  assert.match(ctx, /^Context as \/context counts it 82\.2k of 200k 41% · auto-compacts at 83% · opus-5\.5 System prompt 3\.1k System tools 12\.4k MCP tools 8\.2k/)
  assert.match(ctx, /MCP tools \(deferred\) 4\.1k Compactions 3\dm researcher auto · 176k → 44k tokens “Mapping the public routes/)
  assert.match(ctx, /1\dm Orchestrator auto · 92% → 18% “This session is being continued/)
  assert.equal(find(p.view('ContextSection()'), 'ctx-seg').length, 8)
  // Permissions: every decision, newest first; who decided and why, verbatim; the mode at the head's right
  const perms = find(p.view('PermissionsSection()'), 'perm-row')
  assert.deepEqual(perms.map(r => r.k), SAMPLE.inspect.permissions.decisions.map(d => d.id))
  assert.match(p.text('PermissionsSection()'), /^Permissions 7 auto mode builder Bash npm test -- rateLimit Waiting on you its dialog is open in Claude Code 2m/)
  assert.match(flat(textOf(perms[1])), /^builder Bash git push --force origin main Denied by auto mode Force-pushing to main overwrites history/)
  assert.match(flat(textOf(perms[3])), /^docs Edit \.env Blocked by your hook PreToolUse: “\.env files are off limits”/)
  assert.deepEqual(perms.map(r => find(r, 'perm-verdict')[0].p.class), ['perm-verdict tx-wait', 'perm-verdict tx-fail', 'perm-verdict tx-done', 'perm-verdict tx-fail', 'perm-verdict tx-done', 'perm-verdict tx-wait', 'perm-verdict tx-done'])
  // a name opens its drawer over Inspect
  click(find(perms[1], 'who-link')[0])
  assert.equal(p.run('location.hash'), `#/inspect/agent/${BUILDER}`)
  p.run('closeDrawer()')
  // Loaded: the model and its settings, the files, memory, the skills, the MCP servers, the hooks and what their event decided
  const ld = p.text('LoadedSection()')
  assert.match(ld, /^Loaded Model opus-5\.5 effort high · output style default auto mode Instructions ~\/\.claude\/CLAUDE\.md yours, for every project · 6 lines · 310 tokens loaded at start acme-api\/CLAUDE\.md this project · 41 lines · 1\.5k tokens loaded at start src\/CLAUDE\.md this project · 240 tokens loaded on reading app\.ts/)
  assert.match(ld, /Memory Memory · 4 files MEMORY\.md · redis-in-ci\.md · api-conventions\.md · ask-before-pushing\.md 570 tokens Skills 23 skills used this session: code-review, run Every name/)
  assert.match(ld, /MCP servers github 12 tools · 2 loaded on demand · used 4 times linear 8 tools · 8 loaded on demand Hooks Stop powershell .* yours PreToolUse · Edit\|Write node \.claude\/hooks\/protect-secrets\.js project PreToolUse hooks decided 1 call, blocked 1$/)
  // every skill's name on demand
  click(find(p.view('LoadedSection()'), 'btn-xs')[0])
  assert.match(p.text('LoadedSection()'), /code-review · run · simplify · security-review/)
  // Spend: the context, the spend at API prices, the tokens and the agents; what the spend is, once; then each agent's tokens, requests, tool calls and failures
  const ins = p.text('InspectSection()')
  assert.match(ins, /^Spend This session Context 41% At API prices ≈\$4\.12 Tokens 2\.3M Agents 8 Claude Code’s \/cost estimate at API list prices, not a bill on a subscription; it drops earlier runs that didn’t close normally \(a crash, a kill or a shutdown\)\. Tokens by agent Agent Model In Out Cache Total Req Tools Err/)
  assert.match(ins, /Orchestrator opus-5\.5 182k 21\.3k 1\.2M 1\.4M 31 10 0 researcher haiku-4\.5 41k 2\.1k 88k 131k 6 18 0/)
  assert.match(ins, /Lint the new files haiku-4\.5 9k 600 12k 21\.6k 2 1 1/)
  assert.equal(find(p.view('InspectSection()'), 'bar-fill')[0].p.style.width, '41%')
  // folded: each section its head and its one line
  for (const id of ['ins-context', 'ins-permissions', 'ins-loaded', 'ins-spend']) p.run(`setShut("${id}", true)`)
  assert.equal(p.text('Page()'), 'Context 41% · compacted 2 times Permissions 7 7 decisions · 1 waiting on you · 1 denied · 1 blocked Loaded 3 instruction files · 4 memory files · 23 skills · 2 MCP servers · 2 hooks Spend ≈$4.12 · 2.3M tokens')
  // an old link to Inspect over a tab, and #/inspect, open Inspect; #/help opens Settings
  for (const [hash, tab] of [['#/chat/inspect', 'inspect'], ['#/inspect', 'inspect'], ['#/help', 'settings']]) {
    const old = page({ hash })
    assert.deepEqual({ tab: old.run('route.tab'), drawer: old.run('route.drawer') }, { tab, drawer: null }, hash)
  }
  // a state with nothing of Inspect's (an older mod's): the spend alone; nothing yet: the welcome
  const older = page({ hash: '#/inspect' })
  older.load(sample(s => { s.inspect = { contextPercent: 41, costUsd: 4.12, agents: s.inspect.agents } }))
  assert.deepEqual(find(older.view('Page()'), 'sec-title').map(t => flat(textOf(t))), ['Spend'])
  const empty = page({ hash: '#/inspect' })
  empty.load({ v: 1, empty: true })
  assert.match(empty.text('Page()'), /Nothing yet/)
})

test('Settings (6, #/settings) holds the avatar style and Help, laid out as a page', () => {
  const p = page()
  p.load(SAMPLE)
  assert.equal(p.key('6'), true)
  assert.equal(p.run('route.tab'), 'settings')
  assert.equal(p.run('location.hash'), '#/settings')
  assert.ok(find(p.view('Header()'), 'tab')[5].p.class.includes(' on'))
  assert.deepEqual(find(p.view('Page()'), 'sec-title').map(t => flat(textOf(t))), ['Avatar style', 'Help'])
  // Help: what each tab is for, each name going to it; then the keys
  const help = p.text('HelpSection()')
  assert.match(help, /^Help Dashboard What needs you, a card per agent.* Chat The session as a group chat\..* Org Every agent under the one that started it.* Changes Git's uncommitted files.* Inspect What fills the context and each compaction.* Settings This page/)
  assert.match(help, /Keys .* 1 2 3 4 5 6 Dashboard · Chat · Org · Changes · Inspect · Settings j k Move the focus down, up/)
  // no f key, said or kept
  assert.match(help, /1 to 6, Enter and b work in the Desktop pane and the terminal too/)
  assert.equal(findAll(p.view('HelpSection()'), one => one.t === 'dt' && flat(textOf(one)) === 'f').length, 0)
  assert.deepEqual(find(p.view('HelpSection()'), 'help-tab-name').map(a => a.p.href), ['#/now', '#/chat', '#/org', '#/changes', '#/inspect', '#/settings'])
  // with nothing yet, Settings still draws: the avatar style and the help are the deck's own
  const empty = page({ hash: '#/settings' })
  empty.load({ v: 1, empty: true })
  assert.match(empty.text('Page()'), /^Avatar style .* Help Dashboard/)
  assert.equal(empty.key('n'), false)
  assert.equal(empty.key('1'), true)
  assert.match(empty.text('Page()'), /Nothing yet/)
})

test('i opens Inspect and h brings Settings` Help into view (a folded one opened); pressed again there, back to the tab you came from', () => {
  const p = page({ hash: '#/org' })
  p.load(SAMPLE)
  assert.equal(p.key('i'), true)
  assert.equal(p.run('route.tab'), 'inspect')
  assert.equal(p.run('location.hash'), '#/inspect')
  p.key('i')
  assert.equal(p.run('route.tab'), 'org')
  p.run('setShut("help", true)')
  p.key('h')
  assert.equal(p.run('route.tab'), 'settings')
  assert.equal(p.run('ui.scrollTo.id'), 'sec-help')
  assert.equal(p.run('shut.has("help")'), false, 'opened')
  p.key('?')
  assert.equal(p.run('route.tab'), 'org')
  // the Inspect tab itself, then i: back
  p.key('5')
  p.key('i')
  assert.equal(p.run('route.tab'), 'org')
  // none fires while you type
  assert.equal(p.key('i', 'TEXTAREA'), false)
  assert.equal(p.run('route.tab'), 'org')
})

// ---- keys, and live updates

test('keys: 1 2 3 4 5 the routes, n the next need (opened and focused), m and @ the composer, b and Esc close; none fires while you type', () => {
  const p = page()
  p.load(SAMPLE)
  assert.equal(p.key('2'), true)
  assert.equal(p.run('route.tab'), 'chat')
  assert.equal(p.run('location.hash'), '#/chat')
  p.key('3')
  assert.equal(p.run('route.tab'), 'org')
  assert.equal(p.run('location.hash'), '#/org')
  p.key('4')
  assert.equal(p.run('route.tab'), 'changes')
  p.key('5')
  assert.equal(p.run('route.tab'), 'inspect')
  p.key('6')
  assert.equal(p.run('route.tab'), 'settings')
  p.key('1')
  assert.equal(p.run('location.hash'), '#/now')
  // typing: the key is the text's
  assert.equal(p.key('2', 'TEXTAREA'), false)
  assert.equal(p.run('route.tab'), 'now')
  // n: each need in turn, opened, brought into view and focused
  p.run('navigate("chat")')
  p.key('n')
  assert.equal(p.run('route.tab'), 'now')
  assert.equal(p.run('ui.scrollTo.id'), `need-${ASK_ONE}`)
  p.key('n')
  assert.equal(p.run('ui.scrollTo.id'), 'need-toolu_01BldB2')
  assert.equal(p.run('ui.needOpen.get("toolu_01BldB2")'), true)
  assert.ok(find(p.view('NeedsSection()'), 'need')[1].p.class.includes('open'))
  p.load(sample(s => { s.needs = [] }))
  p.key('n')
  assert.equal(p.run('ui.toast.text'), 'Nothing needs you')
  // @: the composer with @ typed; m in an agent's drawer: its own composer
  p.key('@')
  assert.equal(p.run('route.tab'), 'chat')
  assert.equal(p.run('ui.drafts.get("chat")'), '@')
  assert.equal(p.run('ui.focusTo'), 'composer-chat')
  p.open(`{ kind: "agent", id: "${REVIEWER}" }`)
  p.key('m')
  assert.equal(p.run('ui.focusTo'), `composer-${REVIEWER}`)
  // Esc closes the drawer; b the same; typing, Esc leaves the field
  assert.equal(p.key('Escape'), true)
  assert.equal(p.run('route.drawer'), null)
  p.open(`{ kind: "agent", id: "${REVIEWER}" }`)
  assert.equal(p.key('Escape', 'TEXTAREA'), true)
  assert.equal(p.run('route.drawer.id'), REVIEWER)
  p.key('b')
  assert.equal(p.run('route.drawer'), null)
  assert.equal(p.key('b'), false, 'nothing to go back from')
  // #/ is Now
  const home = page({ hash: '#/' })
  assert.equal(home.run('route.tab'), 'now')
})

test('a live update keeps what you were doing: a half-typed message, an open fold, an open need, the filter, the drawer', () => {
  const p = page({ hash: `#/chat/agent/${BUILDER}` })
  p.load(SAMPLE)
  p.run('ui.drafts.set("chat", "half a thou")')
  p.run(`ui.open.set("fold|fold:${BUILDER}", true)`)
  p.run(`ui.needOpen.set("${ASK_MANY}", true)`)
  p.run(`ui.chatFilter = "${REVIEWER}"`)
  p.load(sample(s => { s.now += 30_000; s.chat.push({ id: 'm-new', at: NOW + 30_000, from: REVIEWER, to: BUILDER, who: 'reviewer → builder', kind: 'message', text: 'And the keys?' }) }))
  assert.equal(p.run('ui.drafts.get("chat")'), 'half a thou')
  assert.equal(p.run('route.drawer.id'), BUILDER)
  assert.equal(p.run('filterOf()'), REVIEWER)
  assert.ok(find(p.view('ChatPage()'), 'brow').some(r => r.k === 'm-new'))
  assert.ok(find(p.view('ChatPage()'), 'member').find(m => m.k === REVIEWER).p.class.includes(' on'))
  p.run('ui.orgView = "list"')
  assert.ok(find(p.view('OrgPage()'), 'arow').some(r => r.k === LINT), 'the fold stays open')
  assert.ok(find(p.view('NeedsSection()'), 'need')[2].p.class.includes('open'))
})

// ---- Avatars

test('the avatars are drawn in the state`s style (robots by default; one the page does not know, robots); Settings lists the ten, each with a preview, the one drawn checked, and a pick posts avatarStyle and draws it at once, until the state names it', async () => {
  const p = page()
  const svgOf = v => decodeURIComponent(v.p.src.replace(/^data:image[/]svg[+]xml;charset=utf-8,/, ''))
  const face = () => svgOf(p.view("Avatar(IX.byId.get('main'), 24)"))
  const ROBOT = '<rect x="7" y="9" width="26" height="22" rx="7"'
  const MOOD = '<circle cx="20" cy="20" r="17"'
  p.load(SAMPLE)
  assert.equal(SAMPLE.avatarStyle, 'robot')
  assert.ok(face().includes(ROBOT))
  // the Orchestrator's own face, seeded by its id: the very document the mod draws in the pane
  assert.equal(face(), AVATARS.avatarSvg('robot', { id: 'main', name: 'Orchestrator', role: 'main', status: 'waiting' }, { size: 24, dot: false, animated: false }))
  p.load(sample(s => { s.avatarStyle = 'mood' }))
  assert.ok(face().includes(MOOD))
  p.load(sample(s => { s.avatarStyle = 'plaid' }))
  assert.ok(face().includes(ROBOT))
  // Settings: the ten styles, each with its sample faces drawn in it, the one drawn checked
  p.load(sample(s => { s.avatarStyle = 'mood' }))
  const picks = () => find(p.view('AvatarSection()'), 'style-pick')
  assert.deepEqual(picks().map(b => flat(textOf(b))), ['Robots', 'Mood faces', 'Critters', 'Pixel sprites', 'Monogram tiles', 'Orbits', 'Bauhaus', 'Progress rings', 'Terminal glyphs', 'Blob faces'])
  const checked = () => picks().filter(b => b.p['aria-checked'] === 'true').map(b => flat(textOf(b)))
  assert.deepEqual(checked(), ['Mood faces'])
  for (const [i, b] of picks().entries()) {
    const faces = findAll(b, v => v.t === 'img')
    assert.equal(faces.length, 3)
    assert.equal(svgOf(faces[0]), AVATARS.avatarSvg(AVATARS.STYLE_IDS[i], { id: 'bob', name: 'bob', role: '', status: 'done' }, { size: 30, dot: true, animated: false }))
  }
  assert.deepEqual(picks().map(b => find(b, 'style-check').length), [0, 1, 0, 0, 0, 0, 0, 0, 0, 0])
  // a pick: the command goes, and the page draws it at once
  click(picks()[2])
  await settle()
  const sent = p.commands().at(-1)
  assert.equal(sent.cmd, 'avatarStyle')
  assert.equal(sent.style, 'critter')
  assert.match(sent.id, /^av-/)
  assert.equal(p.run('styleNow()'), 'critter')
  assert.deepEqual(checked(), ['Critters'])
  // the state names it; from then on the state's is drawn, whoever picks next (the pane, /deck avatars)
  p.load(sample(s => { s.avatarStyle = 'critter' }))
  assert.equal(p.run('styleNow()'), 'critter')
  p.load(sample(s => { s.avatarStyle = 'blob' }))
  assert.equal(p.run('styleNow()'), 'blob')
  // picking the one drawn sends nothing
  const count = p.commands().length
  click(picks()[9])
  await settle()
  assert.equal(p.commands().length, count)
})

test('Org (and Chat`s members) draw the agents in the style in force: the state`s, or one just picked in Settings', async () => {
  const p = page({ hash: '#/org' })
  const svgOf = v => decodeURIComponent(v.p.src.replace(/^data:image[/]svg[+]xml;charset=utf-8,/, ''))
  const card = () => findAll(byText(p.view('OrgPage()'), 'org-card', 'builder'), v => v.t === 'img')[0]
  const member = () => findAll(find(p.view('ChatPage()'), 'member').find(m => m.k === BUILDER), v => v.t === 'img')[0]
  const drawn = (style, size, opts) => p.run(`AV.avatarSvg(${JSON.stringify(style)}, faceOf(IX.byId.get(${JSON.stringify(BUILDER)})), ${JSON.stringify({ size, ...opts })})`)
  p.load(sample(s => { s.avatarStyle = 'mood' }))
  assert.equal(svgOf(card()), drawn('mood', 34, { dot: true, animated: true }))
  assert.ok(svgOf(card()).includes('<circle cx="20" cy="20" r="17"'))
  assert.equal(svgOf(member()), drawn('mood', 24, { dot: false, animated: false }))
  await p.run('pickStyle("pixel")')
  assert.equal(svgOf(card()), drawn('pixel', 34, { dot: true, animated: true }))
  assert.equal(svgOf(member()), drawn('pixel', 24, { dot: false, animated: false }))
  // a pick holds until the state names it, 10 s at most: then the state's, whoever picked it
  p.setNow(NOW + 11_000)
  p.load(sample(s => { s.now = NOW + 11_000; s.avatarStyle = 'bauhaus' }))
  assert.equal(svgOf(card()), drawn('bauhaus', 34, { dot: true, animated: true }))
})

// ---- Background and Stop

const BG_NONE = { rows: [], tasks: 0, scheduled: 0, text: '' }

test('Background: under the agents while something runs or is scheduled, its counts at the head`s right; a row each, its kind, title and what it is, who started it, its status, its age or next run on the page`s clock; Stop or Cancel only where Claude Code allows it, sent as stopBackground, its ack a toast', async () => {
  const p = page()
  p.load(SAMPLE)
  const sec = () => find(p.view('NowPage()'), 'sec-background')[0]
  assert.equal(flat(textOf(find(sec(), 'sec-title')[0])), 'Background 5')
  assert.equal(flat(textOf(find(sec(), 'sec-note')[0])), '2 shells · 1 monitor · 2 scheduled')
  const rows = () => find(sec(), 'bg-row')
  assert.deepEqual(rows().map(r => r.k), ['bash_7', 'mon_2', 'bash_3', 'wake_9c2', 'cron_4e1'])
  const row = id => rows().find(r => r.k === id)
  assert.equal(flat(textOf(row('bash_7'))), 'Start the dev server Shell · npm run dev started by builder running 18m Stop')
  assert.equal(flat(textOf(row('mon_2'))), 'CI checks on PR 42 Monitor started by Orchestrator running 3m Stop')
  // first seen in Claude Code's snapshot: no starter, no age; Claude Code would ask before TaskStop, so no Stop
  assert.equal(flat(textOf(row('bash_3'))), 'Watch the limiter tests Shell · npx vitest --watch running')
  // a shell by its description reads as words
  assert.equal(find(row('bash_7'), 'bg-title')[0].p.class, 'bg-title')
  assert.equal(find(row('bash_3'), 'bg-stop').length, 0)
  assert.equal(flat(textOf(row('wake_9c2'))), 'Check the deploy finished Wakeup started by Orchestrator scheduled in 18m Cancel')
  assert.equal(flat(textOf(row('cron_4e1'))), "Summarise yesterday's PRs Cron · Every weekday at 9:00 started by Orchestrator scheduled in 11h Cancel")
  // its age and next run run on the page's clock
  p.setNow(NOW + 10 * MIN)
  assert.match(flat(textOf(row('bash_7'))), / 28m Stop$/)
  assert.match(flat(textOf(row('wake_9c2'))), / in 8m Cancel$/)
  p.setNow(NOW)
  // Stop: stopBackground by its id, the button busy until its ack, which is a toast
  click(find(row('bash_7'), 'bg-stop')[0])
  await settle()
  const sent = p.commands().pop()
  assert.deepEqual({ cmd: sent.cmd, bgId: sent.bgId }, { cmd: 'stopBackground', bgId: 'bash_7' })
  assert.equal(flat(textOf(find(row('bash_7'), 'bg-stop')[0])), '…')
  p.load(sample(s => { s.now = NOW + 1; s.acks.push({ id: sent.id, ok: true, status: 'delivered', text: 'Stopped npm run dev', at: NOW }) }))
  assert.equal(p.run('ui.toast.text'), 'Stopped npm run dev')
  assert.equal(flat(textOf(find(row('bash_7'), 'bg-stop')[0])), 'Stop')
  // a shell with no description of its own goes by its command, in code's face
  p.load(sample(s => { s.now = NOW + 2; Object.assign(s.background.rows[0], { title: 'npm run dev', what: 'Shell' }) }))
  assert.equal(find(row('bash_7'), 'bg-title')[0].p.class, 'bg-title mono')
  // nothing in the background: no section
  p.load(sample(s => { s.now = NOW + 3; s.background = BG_NONE }))
  assert.equal(find(p.view('NowPage()'), 'sec-background').length, 0)
})

test('Stop turn at the header`s right while the main loop`s turn runs, sent as abortTurn with that turn; Stop beside a background agent`s or a teammate`s card (never inside it, and none on the Orchestrator`s) and in its drawer, sent as stopAgent; where none is offered, the drawer says why', async () => {
  const p = page()
  p.load(SAMPLE)
  const stopTurn = () => find(p.view('Header()'), 'stop-turn')[0]
  assert.equal(flat(textOf(stopTurn())), 'Stop turn')
  click(stopTurn())
  await settle()
  let sent = p.commands().pop()
  assert.deepEqual({ cmd: sent.cmd, turnId: sent.turnId }, { cmd: 'abortTurn', turnId: SAMPLE.header.turn.id })
  assert.equal(flat(textOf(stopTurn())), 'Stopping…')
  // a refused one says why
  p.load(sample(s => { s.now = NOW + 1; s.acks.push({ id: sent.id, ok: false, status: 'failed', text: 'That turn has ended', at: NOW }) }))
  assert.equal(p.run('ui.toast.text'), 'Not stopped: That turn has ended')
  // between turns: none
  p.load(sample(s => { s.now = NOW + 2; s.header.turn = null }))
  assert.equal(find(p.view('Header()'), 'stop-turn').length, 0)

  p.load(SAMPLE)
  const wraps = find(p.view('AgentsSection()'), 'run-wrap')
  assert.deepEqual(wraps.map(w => w.k), [`wrap:${BUILDER}`, `wrap:${REVIEWER}`])
  // the card stays one button; its Stop sits beside it
  for (const w of wraps) {
    assert.equal(find(w, 'run-card')[0].t, 'button')
    assert.equal(find(find(w, 'run-card')[0], 'run-stop').length, 0)
    assert.equal(flat(textOf(find(w, 'run-stop')[0])), 'Stop')
  }
  click(find(wraps[0], 'run-stop')[0])
  await settle()
  sent = p.commands().pop()
  assert.deepEqual({ cmd: sent.cmd, agentId: sent.agentId }, { cmd: 'stopAgent', agentId: BUILDER })
  assert.equal(p.run('route.drawer'), null, 'a Stop opens no drawer')

  // in its drawer: Stop beside Message; the Orchestrator's says why it has none
  p.open(`{ kind: "agent", id: "${REVIEWER}" }`)
  assert.equal(flat(textOf(find(p.view('Drawer()'), 'stop-drawer')[0])), 'Stop')
  p.open('{ kind: "agent", id: "main" }')
  assert.equal(find(p.view('Drawer()'), 'stop-drawer').length, 0)
  assert.equal(flat(textOf(find(p.view('Drawer()'), 'stop-why')[0])), 'The Orchestrator stops with its turn: Stop turn ends it')
  // a finished agent: neither
  p.open(`{ kind: "agent", id: "${TESTER}" }`)
  assert.equal(find(p.view('Drawer()'), 'stop-drawer').length + find(p.view('Drawer()'), 'stop-why').length, 0)
})

test('what you stopped from the deck shows in Chat as a small line in the middle, "You stopped builder", never a bubble of yours', () => {
  const p = page({ hash: '#/chat' })
  p.load(sample(s => s.chat.push({ id: 'mstop', at: NOW, from: 'you', to: BUILDER, who: 'You → builder', kind: 'stop', text: 'You stopped builder' })))
  const line = find(p.view('ChatPage()'), 'notice-stop')
  assert.equal(line.length, 1)
  assert.equal(flat(textOf(line[0])), 'You stopped builder now')
  assert.equal(find(line[0], 'notice-who').length, 0)
})

test('Recent activity says a refused call was "⊘ denied" (auto mode) or "⊘ blocked" (your hook); Chat draws each compaction as a line across, which opens on the summary it goes on from, read whole when the state cut it', async () => {
  const p = page()
  // the refused calls and the linter's failed one brought among the ten newest
  p.load(sample(s => { for (const x of s.activity) if (['toolu_01BldB1', 'toolu_01DocE0', 'toolu_01LntB1'].includes(x.id)) x.at = NOW - 30_000 }))
  const rows = find(p.view('ActivitySection()'), 'ra-row')
  const outcome = id => flat(textOf(find(rows.find(r => r.k === id), 'outcome')[0]))
  assert.match(outcome('toolu_01BldB1'), /^⊘ ?denied$/)
  assert.match(outcome('toolu_01DocE0'), /^⊘ ?blocked$/)
  assert.match(outcome('toolu_01LntB1'), /failed$/)
  // Chat: a line for each compaction, whoever's context it was, where it happened
  p.run('navigate("chat")')
  const lines = () => find(p.view('ChatPage()'), 'cmp-line')
  assert.equal(lines().length, 2)
  assert.match(flat(textOf(lines()[0])), /^researcher’s context compacted 176k → 44k tokens · auto 3\dm$/)
  assert.match(flat(textOf(lines()[1])), /^Context compacted 92% → 18% · 184k → 36k tokens · auto 1\dm$/)
  const main = SAMPLE.chat.find(m => m.kind === 'compaction' && m.from === 'main')
  assert.equal(main.isCut, true)
  click(find(lines()[1], 'cmp-head')[0])
  assert.match(flat(textOf(lines()[1])), /The summary it goes on from This session is being continued/)
  assert.deepEqual(p.fetched('message'), [`/message/${main.id}`])
  await settle()
  assert.match(flat(textOf(lines()[1])), /The summary it goes on from This session is being continued .* Next: wait for builder, then run the limiter tests\./)
  // an agent's own conversation keeps its compaction
  p.run(`pickMember("${RESEARCHER}")`)
  assert.equal(lines().length, 1)
})

// ---- what the agents say between their calls

test('the drawer`s Activity lays an agent`s words and its thinking between its calls, newest first: each word quoted in italics after a speech mark, the thought dimmer after "thinking", the head saying once that it may be a summary; "Calls only" leaves them out, kept for every drawer', async () => {
  const storage = {}
  const p = page({ hash: `#/now/agent/${BUILDER}`, storage })
  p.load(SAMPLE)
  const drawer = () => p.view('Drawer()')
  drawer()
  await settle()
  const log = () => [...find(drawer(), 'acts')[0].c].map(one => one.p.class.split(' ').filter(c => c !== 'open').join(' '))
  // newest first: npm test, the words since bench.js, bench.js, the words and the thought after the push, ...
  assert.deepEqual(log(), ['act', 'act-word is-said', 'act-word is-said', 'act-word is-said', 'act', 'act-word is-said', 'act-word is-thought', 'act is-fail', 'act-word is-said', 'act', 'act-word is-said', 'act', 'act-word is-said'])
  const words = find(drawer(), 'act-word')
  assert.match(flat(textOf(words[0])), /^“ ?Running the limiter tests without REDIS_URL ?, as you asked\. ?” \d+m$/)
  assert.equal(find(words[0], 'code').length, 1)
  assert.equal(find(words[0], 'word-mark').length, 1)
  const thought = words.find(one => one.p.class.includes('is-thought'))
  assert.match(flat(textOf(thought)), /^thinking ?Auto mode refused the force-push/)
  assert.equal(find(thought, 'word-lead').length, 1)
  // no label on the row: the Activity head says it once
  assert.ok(!flat(textOf(drawer())).includes('Thinking, as Claude Code shows it'))
  const notes = () => find(drawer(), 'block-note').map(one => flat(textOf(one)))
  assert.equal(notes().filter(one => one.includes('thinking as Claude Code shows it, which may be a summary')).length, 1)
  // the switch, at Activity's head: with their words by default
  const toggle = () => find(drawer(), 'seg-sm')[0]
  assert.deepEqual([...toggle().c].map(b => [flat(textOf(b)), b.p.class]), [['Calls only', ''], ['With their words', 'on']])
  click(toggle().c[0])
  assert.deepEqual(log(), ['act', 'act', 'act is-fail', 'act', 'act'])
  assert.equal(notes().filter(one => one.includes('may be a summary')).length, 0)
  assert.equal(storage['agent-deck:actView'], '"calls"')
  // kept: another page starts on Calls only
  const again = page({ hash: `#/now/agent/${BUILDER}`, storage })
  again.load(SAMPLE)
  again.view('Drawer()')
  await settle()
  assert.equal(find(again.view('Drawer()'), 'act-word').length, 0)
  click(toggle().c[1])
  assert.equal(find(drawer(), 'act-word').length, 8)
  // an agent with no words has no switch
  p.open(`{ kind: "agent", id: "${TESTER}" }`)
  p.view('Drawer()')
  await settle()
  assert.equal(find(drawer(), 'seg-sm').length, 0)
  assert.equal(find(drawer(), 'act-word').length, 0)
})

test('the drawer`s Activity draws words of more lines as Chat draws a message, its Markdown, unquoted; a line of them stays quoted in italics', async () => {
  const file = JSON.parse(FILES.agent[BUILDER])
  const last = file.activity[file.activity.length - 1]
  file.words = [...file.words, { kind: 'said', at: last.at + 1000, step: 99, text: 'Here is the fix:\n\n```js\nconst limit = 10\n```\n\n- **one** store', after: last.id }]
  const p = page({ hash: `#/now/agent/${BUILDER}`, files: { ...FILES, agent: { ...FILES.agent, [BUILDER]: JSON.stringify(file) } } })
  p.load(SAMPLE)
  p.view('Drawer()')
  await settle()
  const words = find(p.view('Drawer()'), 'act-word')
  const lines = words.filter(one => find(one, 'md').length > 0)
  assert.equal(lines.length, 1)
  assert.equal(find(lines[0], 'pre').length, 1)
  assert.match(flat(textOf(lines[0])), /^Here is the fix: const limit = 10 one store/)
  assert.ok(!/[“”*`]/.test(textOf(lines[0])))
  // the rest, a line each, stay quoted
  assert.ok(words.filter(one => one.p.class.includes('is-said') && !lines.includes(one)).every(one => flat(textOf(one)).startsWith('“')))
})

test('an agent at work with no call in flight: its card, its row on Org and its drawer show its latest words in italics after a speech mark; a call in flight shows instead', async () => {
  const words = "The tests share one Redis mock that's never reset. Let me clear it in `beforeEach`."
  const between = s => {
    s.needs = s.needs.filter(n => n.agent !== BUILDER)
    Object.assign(s.agents.find(a => a.id === BUILDER), { status: 'running', needs: 0, live: null, said: { text: words, at: NOW - 30_000 } })
  }
  const p = page({ hash: `#/now/agent/${BUILDER}` })
  p.load(sample(between))
  const card = () => find(p.view('AgentsSection()'), 'run-card').find(c => flat(textOf(c)).startsWith('builder'))
  assert.equal(find(card(), 'said-words').length, 1)
  assert.match(flat(textOf(find(card(), 'run-now')[0])), /^“ ?The tests share one Redis mock that's never reset\. Let me clear it in beforeEach ?\. ?”$/)
  const strip = find(p.view('Drawer()'), 'live')
  assert.deepEqual([...strip].map(s => s.p.class), ['live is-said'])
  assert.match(flat(textOf(strip[0])), /^Said “ ?The tests share one Redis mock .* ?” now$/)
  assert.match(flat(textOf(p.view(`AgentRow(IX.byId.get("${BUILDER}"))`))), /builder “ ?The tests share one Redis mock/)
  // a call begun since shows instead, as before
  p.load(sample(s => { between(s); s.now += 1000; Object.assign(s.agents.find(a => a.id === BUILDER), { said: null, live: { tool: 'Bash', text: 'npm test', at: NOW } }) }))
  assert.equal(find(card(), 'said-words').length, 0)
  assert.deepEqual([...find(p.view('Drawer()'), 'live')].map(s => s.p.class), ['live'])
})

test('Recent activity holds what the agents said among their calls, newest first: "builder said “…”" in italics, with no outcome; the sample`s newest ten hold three', () => {
  const p = page()
  p.load(SAMPLE)
  const rows = find(p.view('ActivitySection()'), 'ra-row')
  const said = rows.filter(r => r.p.class.includes('is-said'))
  assert.equal(said.length, 3)
  assert.match(flat(textOf(said[0])), /^builder said “ ?Running the limiter tests without REDIS_URL ?, as you asked\. ?” \d+m$/)
  assert.match(flat(textOf(said[1])), /^reviewer said “ ?Checking the window math first, then how Retry-After rounds\. ?” \d+m$/)
  assert.equal(flat(textOf(find(said[0], 'outcome')[0])), '')
  assert.equal(find(said[0], 'ra-said').length, 1)
  // a click opens its agent
  click(said[1])
  assert.deepEqual({ ...p.run('route.drawer') }, { kind: 'agent', id: REVIEWER })
})
