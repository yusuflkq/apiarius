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
const SOURCE = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8')
const SAMPLE = JSON.parse(fs.readFileSync(path.join(WEB, 'fixtures', 'state.v2.json'), 'utf8'))
const NOW = SAMPLE.now
const MIN = 60_000

/** The sample's lazy files of one kind (agents, patches, messages), by id. */
const lazy = kind => Object.fromEntries(fs.readdirSync(path.join(WEB, 'fixtures', 'v2', kind)).map(file => [file.replace(/\.[^.]+$/, ''), fs.readFileSync(path.join(WEB, 'fixtures', 'v2', kind, file), 'utf8')]))
const FILES = { agent: lazy('agents'), patch: lazy('patches'), message: lazy('messages') }

const BUILDER = 'b81c6f3e2a9d4c17'
const RESEARCHER = 'a3f9c2e1b7d4058e'
const REVIEWER = 'aa11bb22cc33dd44'
const LINT = 'd2e3f4a5b6c7089a'
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
 * Its fetch answers POST /cmd with {"ok":true} and GET /agent, /patch and
 * /message from `files` (the sample's by default); every call is kept in
 * `calls` (a command's body parsed). Rendering is a no-op: the views are
 * read, not drawn.
 */
function page({ hash = '', now = NOW, files = FILES } = {}) {
  const noop = () => {}
  const calls = []
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => JSON.parse(body), text: async () => body })
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (url === '/cmd') return reply(200, '{"ok":true}')
    const m = /^\/(agent|patch|message)\/([^?]+)/.exec(url)
    if (m) {
      const text = files[m[1]][decodeURIComponent(m[2])]
      return text === undefined ? reply(404, 'no such file\n') : reply(200, text)
    }
    return new Promise(noop)
  }
  const context = vm.createContext({
    __deckTest: true,
    location: { search: '?t=test-token', hash },
    window: { addEventListener: noop },
    document: { title: '', querySelector: () => null, getElementById: () => null },
    localStorage: { getItem: () => null, setItem: noop },
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

test('the header: the state in one word, your latest request in your words, and model · context · cost; the goal opens on its whole text', async () => {
  const p = page()
  p.load(SAMPLE)
  assert.match(p.text('Header()'), /^Waiting on you Also exempt \/health and \/metrics from the limiter\. 4m opus-5\.5 · context 41% · \$4\.12 Now 4 Chat Changes 5/)
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
  p.load(sample(s => Object.assign(s.header, { state: 'idle', stateText: 'Idle', goal: null, line: '' })))
  assert.match(p.text('Header()'), /^Idle No request yet Now 4/)
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
  assert.match(flat(textOf(cards()[3])), /^github elicitation_dialog 1m The github MCP server is asking for your input Answer in Claude Code\.$/)
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

// ---- Now: agents and plan

test('the agents: the state`s rows in its order, each a status dot, its name, its call in flight verbatim and its time; a fold row opens on its members', () => {
  const p = page()
  p.load(SAMPLE)
  const rows = () => [...find(p.view('AgentsSection()'), 'tree')[0].c].filter(Boolean)
  assert.deepEqual(rows().map(r => r.k), ['main', BUILDER, `fold:${BUILDER}`, REVIEWER, 'fold:main'])
  assert.deepEqual(rows().map(r => flat(textOf(r))), [
    'Orchestrator AskUserQuestion Which store should back the limiter in production? 40m',
    'builder Bash npm test -- rateLimit 29m',
    '1 done · 1 failed',
    'reviewer AskUserQuestion Which routes should skip the limiter? 10m',
    '2 done · 1 stopped',
  ])
  assert.deepEqual(rows().map(r => r.p.style['--d']), ['0', '1', '2', '1', '1'])
  assert.deepEqual(find(rows()[0], 'avd-dot').map(d => d.p.class), ['avd-dot hue-wait'])
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
  assert.match(byId('main'), / 45m$/)
  assert.match(byId(BUILDER), / 34m$/)
  assert.match(byId('c4d7e8f9a0b1263d'), / 10m$/)
  // a row opens its agent
  click(rows().find(r => r.k === BUILDER))
  assert.deepEqual({ ...p.run('route.drawer') }, { kind: 'agent', id: BUILDER })
  assert.equal(p.run('location.hash'), `#/now/agent/${BUILDER}`)
  assert.ok(rows().find(r => r.k === BUILDER).p.class.includes(' on'))
})

test('Tree ⇄ Chart: the chart draws every agent row under the one that started it; it opens readable and the fit button shows it all', () => {
  const p = page()
  p.load(SAMPLE)
  click(byText(p.view('AgentsSection()'), 'seg-toggle', 'Chart').c.filter(Boolean)[1])
  assert.equal(p.run('ui.view'), 'chart')
  const chart = p.view('AgentsSection()')
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
  p.load(sample(s => { s.plan = null }))
  assert.equal(p.view('PlanSection()'), null)
  assert.doesNotMatch(p.text('NowPage()'), /Plan/)
})

// ---- Chat

test('Chat: every row reads as a sentence, who: text, with its time on the right; names open their agents; long ones fold and a cut one loads /message/<id> once', async () => {
  const p = page({ hash: '#/chat' })
  p.load(SAMPLE)
  assert.equal(p.run('route.tab'), 'chat')
  const rows = () => find(p.view('ChatPage()'), 'crow')
  assert.equal(rows().length, SAMPLE.chat.length)
  const row = id => rows().find(r => r.k === id)
  const line = id => flat(textOf(find(row(id), 'crow-line')[0]))
  assert.equal(line('m1792011720000_a3f9c2e1b7d4058e_main'), 'researcher → Orchestrator : Found 14 public routes, all mounted in src/app.ts after auth() . No limiter exists. The Redis client ( ioredis ) is already a dependency.')
  assert.equal(textOf(find(row('m1792011720000_a3f9c2e1b7d4058e_main'), 'crow-time')[0]), '31m')
  // a SendMessage, titled by its summary; words to nobody in particular; a name no agent carries
  assert.match(line('m1792013040000_b81c6f3e2a9d4c17_aa11bb22cc33dd44'), /^builder → reviewer : Limiter ready for review · src\/rateLimit\.ts and both stores are in\./)
  assert.equal(line('m1792013130000_b81c6f3e2a9d4c17_'), 'builder : Will do: the store is picked by REDIS_URL, in memory without it.')
  const bot = row('m1792013220000_b81c6f3e2a9d4c17_ops_bot')
  assert.deepEqual(find(bot, 'name-link').map(textOf), ['builder'])
  assert.match(flat(textOf(bot)), /^builder → ops-bot : A Redis for CI · Can CI start a Redis service/)
  // Claude Code's own words
  assert.match(line('m1792013520000_engine_you'), /^Claude Code → you : github · The github MCP server is asking for your input$/)
  // a question still held on you points to its card
  assert.match(flat(textOf(row('m1792013400000_main_you'))), /Answer it on Now/)
  click(byText(row('m1792013400000_main_you'), 'more', 'Answer it on Now'))
  assert.equal(p.run('route.tab'), 'now')
  assert.deepEqual({ ...p.run('ui.scrollTo'), until: 0 }, { id: `need-${ASK_ONE}`, on: 'now', until: 0, focus: true })
  // a name opens its agent
  click(find(row('m1792011720000_a3f9c2e1b7d4058e_main'), 'name-link')[0])
  assert.equal(p.run('route.drawer.id'), RESEARCHER)
  // the cut answer: two lines until asked, then the whole of it, fetched once
  const cut = 'm1792011780000_main_you'
  assert.ok(find(row(cut), 'crow-line')[0].p.class.includes('clamp'))
  click(byText(row(cut), 'crow-more', 'Show more'))
  assert.equal(p.run('ui.holdChat'), true)
  assert.match(flat(textOf(row(cut))), /Loading the rest…/)
  await settle()
  assert.match(flat(textOf(row(cut))), /^Orchestrator → you : Here is where things stand\..*Two things are open: which store backs production, and which routes skip the limiter\./)
  assert.equal(find(row(cut), 'md').length, 1)
  click(byText(row(cut), 'crow-more', 'Show less'))
  click(byText(row(cut), 'crow-more', 'Show more'))
  await settle()
  assert.deepEqual(p.fetched('message'), [`/message/${cut}`])
})

test('the chips filter Chat: All · You · each agent in the tree`s order · Between agents; f moves to the next', () => {
  const p = page({ hash: '#/chat' })
  p.load(SAMPLE)
  const chips = () => find(p.view('ChatPage()'), 'chip')
  assert.deepEqual(chips().map(c => flat(textOf(c))), ['All', 'You', 'Orchestrator', 'builder', 'tester', 'Lint the new files', 'reviewer', 'researcher', 'docs', 'scout', 'Between agents'])
  const shown = () => find(p.view('ChatPage()'), 'crow').map(r => r.k)
  const pick = label => click(chips().find(c => flat(textOf(c)) === label))
  pick('You')
  assert.ok(shown().every(id => /_you(_|$)|^m\d+_you_/.test(id)), shown().join())
  assert.equal(shown().length, 9)
  pick('builder')
  // everything to or from it, and Claude Code's word about it (its permission prompt)
  assert.ok(shown().includes('m1792013436000_engine_you'))
  assert.ok(shown().includes('m1792013220000_b81c6f3e2a9d4c17_ops_bot'))
  assert.equal(shown().length, 10)
  pick('Between agents')
  assert.ok(!shown().some(id => /_you|engine/.test(id)), shown().join())
  assert.ok(shown().includes('m1792013220000_b81c6f3e2a9d4c17_ops_bot'))
  assert.equal(shown().length, 13)
  // f: the next chip, on Chat
  pick('All')
  p.run('navigate("now")')
  assert.equal(p.key('f'), true)
  assert.equal(p.run('route.tab'), 'chat')
  assert.equal(p.run('ui.chatFilter'), 'you')
  p.key('f')
  assert.equal(p.run('ui.chatFilter'), 'main')
  // an agent gone from the session reads as All
  p.run('ui.chatFilter = "gone"')
  assert.ok(chips()[0].p.class.includes('on'))
})

test('the composer: no @ goes to the Orchestrator, @name to that agent by SendMessage, as W.recipientOf reads it; the preview says where, the ack what came of it', async () => {
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
  assert.deepEqual(preview('Ship it'), { text: '→ Orchestrator' })
  assert.deepEqual(preview('@researcher what did you find?'), { text: '→ researcher via SendMessage' })
  assert.deepEqual(preview('@re'), { text: 'Tab picks the first', hint: true })
  assert.deepEqual(preview('@zz hi'), { text: 'No agent named @zz in this session', err: true })
  // typing an @name: the agents it can be, picked by a click or Tab
  p.run('ui.drafts.set("chat", "@re")')
  assert.deepEqual(find(p.view('Composer("chat")'), 'pick-handle').map(textOf), ['@reviewer', '@researcher'])
  click(find(p.view('Composer("chat")'), 'pick')[1])
  assert.equal(p.run('ui.drafts.get("chat")'), '@researcher ')

  // a send: the command, the row it shows as at once, then what its ack says
  p.run('ui.drafts.set("chat", "@builder Keep the Redis store optional.")')
  await p.run('sendChat("chat")')
  const [cmd] = p.commands()
  assert.deepEqual(cmd, { cmd: 'chat', id: cmd.id, agentId: BUILDER, text: 'Keep the Redis store optional.' })
  assert.equal(p.run('ui.drafts.has("chat")'), false, 'the box is cleared')
  const mine = () => find(p.view('ChatPage()'), 'crow').find(r => r.k === `out:${cmd.id}`)
  assert.match(flat(textOf(mine())), /^YO You → builder : Keep the Redis store optional\. Sending… now$/)
  p.load(sample(s => {
    s.chat.push({ id: 'm-mine', at: NOW, from: 'you', to: BUILDER, who: 'You → builder', kind: 'chat', text: 'Keep the Redis store optional.', ackId: cmd.id })
    s.acks.push({ id: cmd.id, ok: true, status: 'delivered', text: 'It reads it at its next step', at: NOW })
  }))
  assert.match(flat(textOf(mine())), /Delivered: it reads it at its next step/)
  assert.equal(find(p.view('ChatPage()'), 'crow').filter(r => /Keep the Redis store optional\./.test(textOf(r)) && r.k !== 'm1792013100000_you_b81c6f3e2a9d4c17').length, 1, 'one row, its key kept')
  // none comes: after a while the page says so
  p.run('ui.drafts.set("chat", "Anyone there?")')
  await p.run('sendChat("chat")')
  p.setNow(NOW + 21_000)
  assert.match(flat(textOf(find(p.view('ChatPage()'), 'crow').pop())), /Sent, but Claude Code hasn't confirmed it/)
  // a name no agent carries is refused before it goes
  p.run('ui.drafts.set("chat", "@ops-bot hello")')
  await p.run('sendChat("chat")')
  assert.equal(p.commands().length, 2)
  assert.match(p.text('Composer("chat")'), /No agent named @ops-bot in this session/)
})

test('the sample`s acks show under the rows they name, while they matter: refused, queued; a delivered one is old news once its agent spoke after it', () => {
  const p = page({ hash: '#/chat' })
  p.load(SAMPLE)
  const note = id => { const r = find(p.view('ChatPage()'), 'crow').find(one => one.k === id); return find(r, 'crow-note').map(n => flat(textOf(n))) }
  assert.deepEqual(note('m1792012620000_you_d2e3f4a5b6c7089a'), ['Not delivered: it has ended'])
  assert.deepEqual(note('m1792013340000_you_main'), ['Queued: Claude reads it when it finishes its current turn'])
  assert.deepEqual(note('m1792013100000_you_b81c6f3e2a9d4c17'), [])
  // this build's word on Stop: as the mod words it
  assert.equal(p.run('ackState({ ok: false, status: "failed", text: "Not in this build yet: press Esc in Claude Code" }).text'), 'Not in this build yet: press Esc in Claude Code')
})

// ---- Changes

test('Changes: git`s files, each opening on the agents` own patches of it; the other edits, those outside the repo folded; commits; Review asks first', async () => {
  const p = page({ hash: '#/changes' })
  p.load(SAMPLE)
  const view = () => p.view('ChangesPage()')
  assert.match(flat(textOf(view())), /^5 uncommitted files \+16 −2 feat\/rate-limit ↑1 · 9c1e4b7 · acme-api Ask for review Uncommitted 5/)
  assert.deepEqual(find(view(), 'chg').map(c => c.k), ['src/app.ts', 'src/rateLimit.ts', 'tests/rateLimit.test.ts', 'docs/api.md', 'package.json'])
  click(find(find(view(), 'chg')[0], 'chg-head')[0])
  const app = () => find(view(), 'chg')[0]
  assert.match(flat(textOf(app())), /The agent edit of this file Edit builder 24m ago \+2 −1/)
  await settle()
  assert.deepEqual(p.fetched('patch'), ['/patch/toolu_01BldE1'])
  assert.deepEqual(find(app(), 'dl').map(l => l.p.class), ['dl dl-hunk', 'dl dl-ctx', 'dl dl-add', 'dl dl-ctx', 'dl dl-del', 'dl dl-add'])
  click(find(find(view(), 'chg')[4], 'chg-head')[0])
  assert.match(flat(textOf(find(view(), 'chg')[4])), /No agent edited this file in this session\.$/)
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

// ---- the drawers

test('the agent drawer: its task, live call, result and todos; Activity from /agent/<fileId>, every call opening on all of it; its edits; Chat with it; Message', async () => {
  const p = page({ hash: `#/now/agent/${BUILDER}` })
  p.load(SAMPLE)
  assert.deepEqual({ ...p.run('route.drawer') }, { kind: 'agent', id: BUILDER })
  const drawer = () => p.view('Drawer()')
  assert.match(flat(textOf(drawer())), /^builder general-purpose · sonnet-4\.5 · background waiting on you 29m started by Orchestrator 513k tokens b81c6f3 Message Chat with builder builder needs permission Bash 2m npm test -- rateLimit/)
  // the need above shows its call in flight already: no second line of it
  assert.equal(find(drawer(), 'live').length, 0)
  assert.match(flat(textOf(drawer())), /Task Write a sliding-window rate limiter in src\/rateLimit\.ts/)
  assert.deepEqual(p.fetched('agent'), [`/agent/${BUILDER}`])
  await settle()
  const acts = () => find(drawer(), 'act')
  assert.deepEqual(acts().map(a => flat(textOf(find(a, 'act-head')[0]))), [
    'Bash Run the limiter tests waiting 2m',
    'Write C:/Users/sam/AppData/Local/Temp/bench.js 200ms 11m',
    'Edit src/app.ts 300ms 24m',
    'Write src/rateLimit.ts 400ms 27m',
  ])
  click(find(acts()[0], 'act-head')[0])
  assert.match(flat(textOf(acts()[0])), /npm test -- rateLimit toolu_01BldB2 · no result yet/)
  click(find(acts()[2], 'act-head')[0])
  await settle()
  assert.ok(find(acts()[2], 'dl-add').length > 0, 'an edit opens on its patch')
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

test('Inspect: context, cost and tokens per agent, by i or the header`s button', () => {
  const p = page()
  p.load(SAMPLE)
  p.key('i')
  assert.deepEqual({ ...p.run('route.drawer') }, { kind: 'inspect' })
  const text = p.text('Drawer()')
  assert.match(text, /^Inspect This session Context 41% Cost \$4\.12 Tokens 2\.3M Tokens by agent 8 agents Agent Model In Out Cache Req Tools Err/)
  assert.match(text, /Orchestrator opus-5\.5 182k 21\.3k 1\.2M 31 2 0 researcher haiku-4\.5 41k 2\.1k 88k 6 2 0/)
  assert.match(text, /Lint the new files haiku-4\.5 9k 600 12k 2 1 1/)
  p.key('i')
  assert.equal(p.run('route.drawer'), null)
  click(find(p.view('Header()'), 'icon-btn')[0])
  assert.equal(p.run('route.drawer.kind'), 'inspect')
})

// ---- keys, and live updates

test('keys: 1 2 3 the routes, n the next need (opened and focused), m and @ the composer, h help, b and Esc close; none fires while you type', () => {
  const p = page()
  p.load(SAMPLE)
  assert.equal(p.key('2'), true)
  assert.equal(p.run('route.tab'), 'chat')
  assert.equal(p.run('location.hash'), '#/chat')
  p.key('3')
  assert.equal(p.run('route.tab'), 'changes')
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
  // h: the keys; Esc closes it, then the drawer; b the same
  p.key('h')
  assert.equal(p.run('ui.help'), true)
  assert.match(p.text('Help()'), /^Keys .* 1 2 3 Now · Chat · Changes j k Move the focus down, up/)
  p.key('Escape')
  assert.equal(p.run('ui.help'), false)
  assert.equal(p.run('route.drawer.id'), REVIEWER)
  p.key('Escape')
  assert.equal(p.run('route.drawer'), null)
  p.key('i')
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
  assert.ok(find(p.view('ChatPage()'), 'crow').some(r => r.k === 'm-new'))
  assert.ok(find(p.view('AgentsSection()'), 'arow').some(r => r.k === LINT), 'the fold stays open')
  assert.ok(find(p.view('NeedsSection()'), 'need')[2].p.class.includes('open'))
})
