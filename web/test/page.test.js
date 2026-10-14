/**
 * The page's views on the states a real session writes, without a browser:
 * app.js runs in a vm context with no DOM (it boots nothing there), each test
 * hands it a state as the server would, and reads the text of the virtual
 * DOM a view builds. The states are shaped on a live run of /deck web: an
 * Orchestrator that plans on the task board and starts three haiku agents in
 * the background, one of which starts a helper of its own.
 */
'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const NOW = 1_791_977_500_000
const MIN = 60_000

/**
 * A fresh page at `hash`, its clock at `now`: app.js in a context of its own.
 * Its fetch answers POST /cmd with {"ok":true} and GET /message/<id> from
 * `messages`; every call is kept in `calls` (a command's body parsed).
 * Rendering is a no-op: the views are read, not drawn.
 */
function page({ hash = '', now = NOW, messages = {} } = {}) {
  const noop = () => {}
  const calls = []
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => JSON.parse(body), text: async () => body })
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (url === '/cmd') return reply(200, '{"ok":true}')
    const message = /^\/message\/([^?]+)/.exec(url)
    if (message) return messages[decodeURIComponent(message[1])] !== undefined ? reply(200, messages[decodeURIComponent(message[1])]) : reply(404, 'no such message\n')
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
    load(state) {
      context.__state = JSON.parse(JSON.stringify(state))
      run('apply(__state)')
    },
    /** The vnode `js` builds. */
    view: js => run(js),
    /** The text `js` builds, its parts joined by spaces. */
    text: js => textOf(run(js)),
    setNow: t => run(`Date.now = () => ${t}`),
  }
}

/** Lets the page's fetches and their promise chains settle. */
const settle = () => new Promise(resolve => setImmediate(resolve))

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

/** The first element under `v` of class `cls` whose text holds `text`. */
function byText(v, cls, text) {
  const found = find(v, cls).find(one => textOf(one).includes(text))
  assert.ok(found, `no .${cls} with "${text}"`)
  return found
}

/** Text with each run of white space as one space. */
const flat = text => text.replace(/\s+/g, ' ')

/** Clicks a vnode: runs its onClick as the browser would. */
const click = v => v.p.onClick({ preventDefault() {}, target: {} })

/** A vnode's text, its children's joined by spaces; icons' markup left out. */
function textOf(v) {
  if (v == null || v === false || v === true) return ''
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(' ')
  if (v.t === '#') return v.s
  if (v.p && v.p.html != null) return ''
  return (v.c || []).map(textOf).filter(Boolean).join(' ')
}

/** Every vnode under `v` whose class has `cls`. */
function find(v, cls, out = []) {
  if (!v || typeof v !== 'object') return out
  if (Array.isArray(v)) {
    for (const one of v) find(one, cls, out)
    return out
  }
  if (v.p && typeof v.p.class === 'string' && v.p.class.split(' ').includes(cls)) out.push(v)
  for (const child of v.c || []) find(child, cls, out)
  return out
}

const GOAL = [
  'You are the orchestrator for a small change in this repository. Do not edit any file yourself; delegate.',
  '',
  '1. First write the plan as a task list with these five steps.',
  '2. Then start three agents in parallel, each with model "haiku".',
  '3. Keep the task list current as each agent finishes.',
  '4. When all of them are done, answer with a short summary.',
].join('\n')

function agent(id, label, extra = {}) {
  return {
    id,
    label,
    scope: '',
    type: 'general-purpose',
    model: 'haiku-5.5',
    kind: 'agent',
    parent: 'main',
    status: 'running',
    needsYou: null,
    startedAt: NOW - 2 * MIN,
    endedAt: null,
    now: '',
    task: `${label}.`,
    result: '',
    checklist: { items: [], done: 0, total: 0 },
    lastAction: null,
    tools: 3,
    errors: 0,
    tokens: { in: 14_000, out: 2_000, cacheRead: 80_000 },
    added: 0,
    removed: 0,
    files: [],
    avatar: 5,
    ...extra,
  }
}

const STEPS = ['Map the repository', 'Add jitter to backoffDelays', 'Add isExpired to token.js', 'Test the jitter option', 'Summarise the changes']

/** The live run's state at one moment; `extra` replaces whole top-level fields. */
function runState(extra = {}) {
  const steps = STEPS.map((text, i) => ({ key: `task:${i + 1}`, text, status: 'pending', agents: [] }))
  return {
    v: 1,
    now: NOW,
    session: { id: 'c33a26ff', cwd: 'C:\\work\\repo', startedAt: NOW - 3 * MIN, model: 'sonnet-5.5' },
    repo: { name: 'repo', root: 'C:/work/repo', branch: 'main', ahead: 0, behind: 0, head: '0f46115923c50a2280b6aebbbf9c92f5fc0f26cc' },
    goal: { headline: 'You are the orchestrator for a small change in this repository. Do not edit any…', text: GOAL, at: NOW - 40_000, followUps: [] },
    needs: { tone: 'quiet', kind: 'busy', text: 'All quiet' },
    summary: { step: null, stepText: null, running: 1, waiting: 0, done: 0, failed: 0, files: 0, added: 0, removed: 0, minutes: 0, tokens: 731_000, costUsd: 0.25, contextPercent: 5 },
    plan: { source: 'board', steps },
    agents: [
      agent('main', 'Orchestrator', { type: 'main loop', model: 'sonnet-5.5', kind: 'orchestrator', parent: null, task: GOAL, now: 'Waiting on 3 agents', avatar: 2, checklist: { items: steps.map(s => ({ text: s.text, status: 'pending' })), done: 0, total: 5 } }),
      agent('ac1c53e313ef213a1', 'Map the repository', { type: 'Explore', task: 'Read-only: list every file in this repository.', now: 'Read src/token.js' }),
      // just started: no tokens counted yet, and its line is its scope
      agent('a84fbb5d74d874189', 'Add jitter', { scope: 'Add jitter to backoffDelays', now: 'Add jitter to backoffDelays', tokens: { in: 0, out: 0, cacheRead: 0 } }),
    ],
    messages: [],
    activity: [],
    files: [],
    edits: [],
    changes: [],
    commits: [],
    ...extra,
  }
}

test('the goal reads once: a headline cut short with "…" is followed by the rest of its text, not the same words again', () => {
  const p = page()
  p.load(runState())
  const card = p.text('GoalCard()')
  assert.equal(card.split('You are the orchestrator for a small change').length - 1, 1, card)
  assert.match(card, /Do not edit any… file yourself; delegate\./)
  // cut inside a word: the rest starts at that word
  p.load(runState({ goal: { headline: 'You are the orchestrator for a small change in this repo…', text: GOAL, at: NOW - 40_000, followUps: [] } }))
  assert.match(p.text('GoalCard()'), /in this repo… repository\. Do not edit any file yourself/)
  // a headline made of other words (a slash command's) leaves the text whole
  p.load(runState({ goal: { headline: '/review src/token.js', text: 'Review the changes in src/token.js for bugs.', at: NOW - 40_000, followUps: [] } }))
  assert.match(p.text('GoalCard()'), /\/review src\/token\.js Review the changes in src\/token\.js for bugs\./)
  // the Plan page keeps the goal's own lines and folds a long one until asked
  p.load(runState({ goal: { headline: 'You are the orchestrator for a small change in this repository. Do not edit any…', text: `${GOAL}\n${'More words. '.repeat(60)}`, at: NOW - 40_000, followUps: [] } }))
  const plan = p.view('PlanPage()')
  const text = find(plan, 'plan-text')[0]
  assert.ok(text.p.class.includes('clamped'))
  assert.match(textOf(text), /^file yourself; delegate\.\n\n1\. First write the plan/)
  assert.match(textOf(plan), /Show the whole goal/)
})

test('no junk numbers: no "Step 0 of 5", no "0 min", no "· 0" tokens; with no step in progress the steps done are counted', () => {
  const p = page()
  p.load(runState())
  const dash = p.text('Dashboard()')
  assert.doesNotMatch(dash, /Step 0 of/)
  assert.match(dash, /0 of 5 done/)
  assert.doesNotMatch(dash, /\b0 min\b/)
  assert.match(dash, /<1 min/)
  const jitter = p.text('RunCard(IX.byId.get("a84fbb5d74d874189"))')
  assert.doesNotMatch(jitter, /· 0\b/)
  assert.match(jitter, /haiku-5\.5/)
  assert.doesNotMatch(p.text('OrgPage()'), /· 0\b/)
  // all steps done: said so, not "No step in progress"
  const done = runState()
  done.plan.steps.forEach(s => { s.status = 'done' })
  p.load(done)
  assert.match(p.text('Kpis()'), /All steps done/)
  assert.match(p.text('GoalCard()'), /5 of 5 done/)
  assert.equal(textOf(find(p.view('RunCard(IX.byId.get("main"))'), 'run-chip')[0]), 'Plan done 5/5')
})

test('a run card never says the same thing twice: the Orchestrator`s chip is its place in the plan, an agent`s line is not its chip again', () => {
  const p = page()
  const state = runState()
  state.plan.steps[0].status = 'done'
  state.plan.steps[1].status = 'active'
  state.summary.step = '2 of 5'
  state.summary.stepText = 'Add jitter to backoffDelays'
  p.load(state)
  const main = p.view('RunCard(IX.byId.get("main"))')
  assert.equal(textOf(find(main, 'run-chip')[0]), 'Add jitter to backoffDelays 1/5')
  assert.doesNotMatch(textOf(main), /You are the orchestrator/)
  const jitter = p.view('RunCard(IX.byId.get("a84fbb5d74d874189"))')
  assert.equal(textOf(find(jitter, 'run-chip-text')[0]), 'Add jitter to backoffDelays')
  assert.equal(textOf(find(jitter, 'run-now')[0]), 'Working')
})

test('every count of agents agrees: the KPI, the org chart`s header and the sidebar count the cards their pills show', () => {
  const p = page()
  const state = runState()
  // the summary counts subagents of the goal only; the page shows the Orchestrator running too
  state.summary.running = 2
  p.load(state)
  assert.match(p.text('Kpis()'), /^3 Agents running 0 waiting · 0 done · 0 failed/)
  assert.match(p.text('OrgPage()'), /^3 agents · 3 running/)
  assert.match(p.text('Sidebar()'), /3 live/)
})

test('the agent page: no empty checklist card, a report`s bold that holds code reads as code, the Orchestrator`s latest answer', () => {
  const p = page()
  const state = runState()
  const jitter = state.agents[2]
  Object.assign(jitter, { status: 'done', endedAt: NOW - MIN, result: 'The `jitter` option is implemented.\n\n**What I changed in `src/retry/backoff-delays.js`:**\n- Added a fourth parameter `jitter = 0`.' })
  state.agents[0].status = 'idle'
  state.agents[0].result = 'All three agents and the jitter helper have finished.'
  p.load(state)
  p.run('route = { name: "agent", id: "a84fbb5d74d874189", key: "agent:a84fbb5d74d874189" }')
  const page1 = p.view('AgentPage()')
  assert.equal(find(page1, 'checklist').length, 0)
  assert.ok(find(page1, 'agent-cols')[0].p.class.includes('single'))
  const strong = find(find(page1, 'result')[0], 'md')[0].c.flatMap(block => block.c || []).find(one => one && one.t === 'strong')
  assert.equal(textOf(strong).replace(/\s+/g, ' '), 'What I changed in src/retry/backoff-delays.js :')
  assert.ok((strong.c || []).some(one => one && one.t === 'code'))
  assert.doesNotMatch(textOf(page1), /`/)
  // a finished agent with no edits: "No edits", not "No edits yet"
  p.run('ui.tabs.set("a84fbb5d74d874189", "diffs")')
  assert.match(p.text('AgentPage()'), /No edits This agent did not edit any files\./)
  // the Orchestrator: its plan is its checklist, its latest answer its report
  p.run('route = { name: "agent", id: "main", key: "agent:main" }')
  const orchestrator = p.text('AgentPage()')
  assert.match(orchestrator, /Checklist 0\/5/)
  assert.match(orchestrator, /Latest answer All three agents and the jitter helper have finished\./)
})

test('Changes lists each file once: the uncommitted files open on their agents` edits, the other edits follow apart', () => {
  const p = page()
  const edit = (id, agentId, file, added, removed) => ({ id, agent: agentId, tool: 'Edit', path: file, at: NOW - MIN, added, removed })
  p.load(runState({
    edits: [edit('toolu_1', 'a84fbb5d74d874189', 'src/retry/backoff-delays.js', 13, 2), edit('toolu_2', 'ac1c53e313ef213a1', 'docs/old-notes.md', 2, 0)],
    changes: [{ path: 'src/retry/backoff-delays.js', code: 'M', added: 13, removed: 2, editors: ['a84fbb5d74d874189'] }],
    files: [
      { path: 'src/retry/backoff-delays.js', editors: ['a84fbb5d74d874189'], live: false, isShared: false, added: 13, removed: 2, lastAt: NOW - MIN },
      { path: 'docs/old-notes.md', editors: ['ac1c53e313ef213a1'], live: false, isShared: false, added: 2, removed: 0, lastAt: NOW - MIN },
    ],
  }))
  const changes = p.text('ChangesPage()')
  assert.equal(changes.split('backoff-delays.js').length - 1, 1, changes)
  assert.match(changes, /Other agent edits 1/)
  assert.match(changes, /old-notes\.md/)
  // every edited file uncommitted: no second list at all
  p.load(runState({
    edits: [edit('toolu_1', 'a84fbb5d74d874189', 'src/retry/backoff-delays.js', 13, 2)],
    changes: [{ path: 'src/retry/backoff-delays.js', code: 'M', added: 13, removed: 2, editors: ['a84fbb5d74d874189'] }],
  }))
  assert.doesNotMatch(p.text('ChangesPage()'), /Other agent edits|Edits by file/)
})

test('once the session ended, how long things ran stops growing with the clock', () => {
  const p = page()
  const state = runState()
  state.agents[0].status = 'idle'
  p.load(state)
  p.run('route = { name: "agent", id: "main", key: "agent:main" }')
  p.run('conn.status = "ended"')
  const ran = () => /ran (\S+)/.exec(p.text('AgentHeader(IX.byId.get("main"))'))[1]
  const before = ran()
  p.setNow(NOW + 90 * MIN)
  assert.equal(ran(), before)
})

test('the org chart opens readable: as wide as the canvas allows, never under 85%, the Orchestrator at the top; the fit button shows it all', () => {
  const p = page()
  const fit = (w, h, vw, vh, mode) => p.run(`fitOf({ w: ${w}, h: ${h} }, ${vw}, ${vh}, '${mode}')`)
  const PAD = p.run('PAD')
  // three agents in a row (3 × 208 + 2 × 24 wide) under the Orchestrator, in the Desktop pane's canvas and at 733 px
  for (const [vw, vh] of [[701, 500], [637, 760]]) {
    const open = fit(768, 360, vw, vh, 'open')
    assert.ok(open.k >= 0.85 && open.k <= 1, `zoom ${open.k} at ${vw}`)
    // the Orchestrator's card starts 24 px below the canvas's top, centred across
    assert.equal(Math.round(open.y + PAD * open.k), 24)
    const left = open.x + PAD * open.k, right = left + 672 * open.k
    assert.ok(Math.abs(left - (vw - right)) <= 1, `centred: ${left} | ${vw - right}`)
  }
  // a tree too wide for the canvas stays at 85% and is a drag away; "all" fits it whole
  const wide = fit(1600, 900, 637, 760, 'open')
  assert.equal(wide.k, 0.85)
  const all = fit(1600, 900, 637, 760, 'all')
  assert.ok(all.k < 0.85 && 1600 * all.k <= 637 - 32 + 1 && 900 * all.k <= 760 - 32 + 1)
  // a small chart never grows past 100%
  assert.equal(fit(400, 300, 1100, 760, 'open').k, 1)
})

// ---- what waits on you, Talk's statuses, the Plan's steps (the contract's pending, acks, answer/question/choice messages)

const CALL = 'toolu_01Rv8NqT3mKc6YwB2xPzL9hF'
const Q_STORE = { question: 'Which store should the limiter use?', header: 'Store', multiSelect: false, options: [{ label: 'Redis (Recommended)', description: 'Shared across instances.' }, { label: 'In-memory', description: 'Per process.' }] }
const Q_ENVS = { question: 'Which environments use Redis?', header: 'Redis', multiSelect: true, options: [{ label: 'Production', description: 'Behind the load balancer.' }, { label: 'Staging', description: 'Mirrors production.' }, { label: 'Preview', description: 'Short-lived.' }] }
const question = (questions, extra = {}) => ({ id: CALL, agentId: 'main', kind: 'question', tool: 'AskUserQuestion', at: NOW - 30_000, questions, isAnswerable: true, ...extra })
const permission = (extra = {}) => ({ id: 'toolu_perm1', agentId: 'ac1c53e313ef213a1', kind: 'permission', tool: 'Bash', at: NOW - 60_000, command: 'npm test -- rateLimit', description: 'Run the rate limiter tests', isAnswerable: false, ...extra })

test('a question waits on you: the Dashboard card shows each question`s header, text and options with their descriptions, a pick for one answer, checkboxes for several, Other… for each; Open goes to the card, pinned above the agent`s tabs', () => {
  const p = page()
  p.load(runState({ pending: [question([Q_STORE, Q_ENVS])], needs: { tone: 'attention', kind: 'blocked', text: 'Orchestrator asks 2 questions', agentId: 'main' } }))
  const dash = p.view('Dashboard()')
  const card = find(dash, 'needs')[0]
  const text = textOf(card)
  assert.match(text, /^Orchestrator asks 2 questions/)
  for (const words of ['Store', 'Which store should the limiter use?', 'Redis (Recommended)', 'Shared across instances.', 'In-memory', 'Per process.', 'Which environments use Redis?', 'pick any', 'Production', 'Behind the load balancer.']) assert.ok(text.includes(words), words)
  // one card: the mod's banner about the same agent would say it again
  assert.equal(find(dash, 'banner').length, 0)
  assert.doesNotMatch(textOf(dash), /AskUserQuestion/)
  assert.deepEqual(find(card, 'q-opt').map(o => [o.t, o.p.role]), [['button', 'radio'], ['button', 'radio'], ['button', 'checkbox'], ['button', 'checkbox'], ['button', 'checkbox']])
  assert.deepEqual(find(card, 'q-other-input').map(i => i.p.placeholder), ['Other…', 'Other…'])
  assert.equal(byText(card, 'btn', 'Submit answers').p.disabled, true, 'nothing picked yet')
  assert.match(textOf(find(dash, 'kpi')[3]), /Orchestrator asks 2 questions/)
  // Open: the agent page, brought to its card
  const open = byText(card, 'banner-btn', 'Open')
  assert.equal(open.p.href, '#/agent/main')
  click(open)
  assert.deepEqual({ ...p.run('ui.scrollTo') }, { id: `pending-${CALL}`, on: 'agent:main', until: NOW + 4000 })
  p.run('route = { name: "agent", id: "main", key: "agent:main" }')
  for (const tab of ['diffs', 'talk']) {
    p.run(`ui.tabs.set("main", "${tab}")`)
    const kids = p.view('AgentPage()').c.filter(Boolean)
    const at = kids.findIndex(k => k.p.class === 'needs-stack')
    assert.ok(at > 0 && kids[at + 1].p.class === 'tabs-wrap', `the card sits right above the tabs (${tab})`)
    assert.equal(kids[at].c.filter(Boolean)[0].p.id, `pending-${CALL}`)
    assert.match(textOf(find(kids, 'needs-jump')[0]), /Orchestrator asks 2 questions Answer/)
  }
})

test('one question with one answer sends on a click: the answer names the page`s id and the call; the ack`s outcome shows, and stays a few seconds once the question resolved', async () => {
  const p = page()
  p.load(runState({ pending: [question([Q_STORE])] }))
  const card = () => find(p.view('NeedsYou()'), 'needs')[0]
  assert.ok(find(card(), 'q-opt').every(o => o.t === 'button' && o.p.role == null), 'plain buttons: a click answers')
  click(find(card(), 'q-opt')[0])
  await settle()
  const [cmd] = p.commands()
  assert.match(cmd.id, /^[A-Za-z0-9_-]{1,40}$/)
  assert.deepEqual(cmd, { cmd: 'answer', id: cmd.id, callId: CALL, answers: { 'Which store should the limiter use?': 'Redis (Recommended)' } })
  // waiting on the ack: the pick shows, nothing more can be sent
  assert.match(textOf(card()), /Sending your answer…/)
  assert.ok(find(card(), 'q-opt').every(o => o.p.disabled === true))
  assert.ok(find(card(), 'q-opt')[0].p.class.includes('on'))
  // the mod answered the call: the item left the state, its ack and the thread say how
  const resolved = runState({
    acks: [{ id: cmd.id, ok: true, status: 'answered', text: 'Claude carries on', at: NOW }],
    messages: [
      { id: 'm1', at: NOW, from: 'main', to: 'you', kind: 'question', text: 'Which store should the limiter use?', callId: CALL },
      { id: 'm2', at: NOW, from: 'you', to: 'main', kind: 'choice', text: 'You answered: Redis (Recommended)', callId: CALL, ackId: cmd.id },
    ],
  })
  p.load(resolved)
  assert.match(textOf(p.view('NeedsYou()')), /^Answered: Claude carries on now Orchestrator asked: Which store should the limiter use\?\s+→\s+Redis \(Recommended\)$/)
  p.setNow(NOW + 13_000)
  p.load(resolved)
  assert.equal(find(p.view('NeedsYou()'), 'needs').length, 0, 'gone after a few seconds')
})

test('several questions take a Submit: checked labels join with ", " in their order, Other text last; Other replaces a pick; a refused answer says why and can go again', async () => {
  const p = page()
  p.load(runState({ pending: [question([Q_STORE, Q_ENVS])] }))
  const card = () => find(p.view('NeedsYou()'), 'needs')[0]
  click(byText(card(), 'q-opt', 'In-memory'))
  click(byText(card(), 'q-opt', 'Staging'))
  click(byText(card(), 'q-opt', 'Production'))
  find(card(), 'q-other-input')[1].p.onInput({ target: { value: 'Canary' } })
  assert.equal(byText(card(), 'btn', 'Submit answers').p.disabled, false)
  // words of your own for the first question: its pick lets go
  find(card(), 'q-other-input')[0].p.onInput({ target: { value: 'Postgres' } })
  assert.equal(find(card(), 'q-opt').filter(o => o.p.class.includes('on')).length, 2)
  click(byText(card(), 'btn', 'Submit answers'))
  await settle()
  const [cmd] = p.commands()
  assert.deepEqual(cmd.answers, { 'Which store should the limiter use?': 'Postgres', 'Which environments use Redis?': 'Production, Staging, Canary' })
  // refused while the question still waits: the card says why and takes an answer again
  p.load(runState({ pending: [question([Q_STORE, Q_ENVS])], acks: [{ id: cmd.id, ok: false, status: 'failed', text: 'Not a question it asked: Which', at: NOW }] }))
  assert.match(textOf(card()), /Not answered: not a question it asked: Which/)
  assert.equal(byText(card(), 'btn', 'Submit answers').p.disabled, false)
  // too late: Claude Code had the answer first, which is no failure of yours
  p.load(runState({ pending: [question([Q_STORE, Q_ENVS])], acks: [{ id: cmd.id, ok: false, status: 'failed', text: 'Already answered in Claude Code', at: NOW }] }))
  assert.match(textOf(card()), /Already answered in Claude Code/)
  assert.doesNotMatch(textOf(card()), /Not answered/)
})

test('a permission shows its exact command or path and description, answered in Claude Code; a question the mod cannot take shows its options read-only', () => {
  const p = page()
  p.load(runState({ pending: [permission(), permission({ id: 'toolu_perm2', agentId: 'a84fbb5d74d874189', tool: 'Edit', command: '', path: 'src/retry/backoff-delays.js', description: '', at: NOW - 10_000 })] }))
  const run = textOf(p.view(`PendingCard(S.pending[0], 'agent')`))
  assert.match(run, /^Map the repository needs your OK to run/)
  assert.match(run, /npm test -- rateLimit Run the rate limiter tests Allow or deny it in Claude Code\.$/)
  const edit = textOf(p.view(`PendingCard(S.pending[1], 'agent')`))
  assert.match(edit, /^Add jitter needs your OK to edit/)
  assert.match(edit, /src\/retry\/ backoff-delays\.js/)
  assert.doesNotMatch(run + edit, /AskUserQuestion/)
  // the Dashboard: the oldest as its card, the next as a row
  const dash = p.view('NeedsYou()')
  assert.equal(find(dash, 'needs').length, 1)
  assert.match(flat(textOf(find(dash, 'needs-row')[0])), /^Add jitter needs your OK to edit src\/retry\/backoff-delays\.js/)
  // after a reload of the mod a question cannot be answered here: shown, read-only
  p.load(runState({ pending: [question([Q_STORE], { isAnswerable: false })] }))
  const ro = p.view(`PendingCard(S.pending[0], 'dash')`)
  assert.equal(findAll(ro, v => v.t === 'button' || v.t === 'input').length, 0)
  assert.deepEqual(find(ro, 'q-opt').map(o => o.t), ['div', 'div'])
  assert.match(textOf(ro), /Redis \(Recommended\) Shared across instances\. In-memory Per process\. Answer it in Claude Code\.$/)
})

test('Talk: the Orchestrator`s answers read as Markdown; a cut one gets Show more, which fetches /message/<id> once; questions and choices read in the thread', async () => {
  const p = page({ messages: { 'm-cut': '**Done.** Here is all of it.\n\n- one\n- two\n- three' } })
  p.load(runState({
    messages: [
      { id: 'm-q', at: NOW - 5 * MIN, from: 'main', to: 'you', kind: 'question', text: 'Per user or per key?', callId: 'toolu_x' },
      { id: 'm-c', at: NOW - 4 * MIN, from: 'you', to: 'main', kind: 'choice', text: 'You answered: Per user', callId: 'toolu_x' },
      { id: 'm-a', at: NOW - 3 * MIN, from: 'main', to: 'you', kind: 'answer', text: 'Done: **/health** skips the limiter.' },
      { id: 'm-cut', at: NOW - MIN, from: 'main', to: 'you', kind: 'answer', text: '**Done.** Here is…', isCut: true },
    ],
  }))
  const talk = () => p.view('TalkTab(IX.byId.get("main"))')
  assert.match(textOf(byText(talk(), 'msg', 'Per user or per key?')), /^Orchestrator asked you 5m Per user or per key\?$/)
  assert.match(textOf(find(talk(), 'kind-choice')[0]), /^You 4m YO You answered: Per user$/)
  const answer = byText(talk(), 'msg', 'skips the limiter')
  assert.match(textOf(answer), /^Orchestrator replied 3m/)
  assert.equal(find(answer, 'md').length, 1)
  assert.equal(findAll(answer, v => v.t === 'strong').length, 1)
  assert.equal(find(answer, 'msg-more').length, 0)
  // the cut one: Show more fetches the rest (when the page draws it open), the thread stays where it is
  click(byText(talk(), 'msg-more', 'Show more'))
  assert.equal(p.run('ui.holdThread'), true)
  assert.match(textOf(byText(talk(), 'msg', 'Here is')), /Loading the rest…$/)
  await settle()
  const fetched = () => p.calls.filter(c => c.url.startsWith('/message/')).map(c => c.url)
  assert.deepEqual(fetched(), ['/message/m-cut?t=test-token'])
  const opened = byText(talk(), 'msg', 'Here is all of it')
  assert.match(textOf(opened), /one two three Show less$/)
  // closed and opened again: from the cache
  click(byText(talk(), 'msg-more', 'Show less'))
  click(byText(talk(), 'msg-more', 'Show more'))
  await settle()
  assert.equal(fetched().length, 1)
})

test('each message you send shows what came of it, by the ack of the id it went with: Sending…, Queued, Delivered, Not delivered, or a word when none comes', async () => {
  const p = page()
  p.load(runState())
  const send = async (id, text) => {
    p.run(`ui.drafts.set(${JSON.stringify(id)}, ${JSON.stringify(text)})`)
    await p.run(`sendChat(IX.byId.get(${JSON.stringify(id)}))`)
    return p.commands().pop()
  }
  const notes = id => find(p.view(`TalkTab(IX.byId.get(${JSON.stringify(id)}))`), 'msg-status').map(textOf)
  const toMain = await send('main', 'And the changelog?')
  assert.match(toMain.id, /^[A-Za-z0-9_-]{1,40}$/)
  assert.deepEqual(toMain, { cmd: 'chat', id: toMain.id, agentId: 'main', text: 'And the changelog?' })
  assert.deepEqual(notes('main'), ['Sending…'])
  assert.equal(p.run('ui.drafts.has("main")'), false, 'the box is cleared')
  // queued for the Orchestrator, and recorded under the command's id: one bubble, its status under it
  const mine = { id: 'm1', at: NOW, from: 'you', to: 'main', kind: 'chat', text: 'And the changelog?', ackId: toMain.id }
  const queued = { id: toMain.id, ok: true, status: 'queued', text: 'Claude reads it when it finishes its current turn', at: NOW }
  p.load(runState({ messages: [mine], acks: [queued] }))
  assert.deepEqual(notes('main'), ['Queued: Claude reads it when it finishes its current turn'])
  assert.equal(find(p.view('TalkTab(IX.byId.get("main"))'), 'bubble').length, 1)
  // once it answered, "Queued" is old news
  p.load(runState({ messages: [mine, { id: 'm2', at: NOW + 1000, from: 'main', to: 'you', kind: 'answer', text: 'In 2.4.0.' }], acks: [queued] }))
  assert.deepEqual(notes('main'), [])
  // an agent at work reads it at its next step
  const toAgent = await send('a84fbb5d74d874189', 'Keep it synchronous.')
  p.load(runState({ messages: [{ id: 'm3', at: NOW, from: 'you', to: 'a84fbb5d74d874189', kind: 'chat', text: 'Keep it synchronous.', ackId: toAgent.id }], acks: [{ id: toAgent.id, ok: true, status: 'delivered', text: 'It reads it at its next step', at: NOW }] }))
  assert.deepEqual(notes('a84fbb5d74d874189'), ['Delivered: it reads it at its next step'])
  // refused: never in the thread; the send says why
  const refused = await send('ac1c53e313ef213a1', 'Hello?')
  p.load(runState({ acks: [{ id: refused.id, ok: false, status: 'failed', text: 'Map the repository takes no messages from here', at: NOW }] }))
  assert.deepEqual(notes('ac1c53e313ef213a1'), ['Not delivered: Map the repository takes no messages from here'])
  // no ack at all: after a while the page says so
  await send('ac1c53e313ef213a1', 'Anyone there?')
  assert.deepEqual(notes('ac1c53e313ef213a1').slice(-1), ['Sending…'])
  p.setNow(NOW + 21_000)
  assert.deepEqual(notes('ac1c53e313ef213a1').slice(-1), ['Sent, but Claude Code hasn\'t confirmed it'])
})

test('activity reads "asked you: <question>" for a question, never "used AskUserQuestion"', () => {
  const p = page()
  p.load(runState({ activity: [{ at: NOW - MIN, agent: 'main', tool: 'AskUserQuestion', target: 'Which store should the limiter use?', ok: null, ms: null }] }))
  const row = flat(p.text('ActivityRow(S.activity[0])'))
  assert.match(row, /^Orchestrator asked you: Which store should the limiter use\?/)
  assert.doesNotMatch(row, /AskUserQuestion|used/)
})

test('Plan: a step opens on its agents and the ones they started, each with its line, checklist, last three calls, files, folded result, a question to answer right there, and links', () => {
  const p = page()
  const state = runState()
  Object.assign(state.plan.steps[1], { status: 'active', agents: ['a84fbb5d74d874189'] })
  Object.assign(state.agents[2], {
    status: 'done', endedAt: NOW - MIN, now: 'Edit src/retry/backoff-delays.js',
    checklist: { items: [{ text: 'Add the option', status: 'done' }, { text: 'Test it', status: 'active' }], done: 1, total: 2 },
    files: ['src/retry/backoff-delays.js', 'test/backoff.test.js'],
    result: `${'A long report line.\n'.repeat(8)}The end.`,
  })
  state.agents.push(agent('a5', 'Jitter helper', { parent: 'a84fbb5d74d874189', type: 'Explore', now: 'Read src/retry/index.js' }))
  state.activity = [1, 2, 3, 4].map(i => ({ at: NOW - (10 - i) * MIN, agent: 'a84fbb5d74d874189', tool: 'Edit', target: `src/file${i}.js`, ok: true, ms: 12 }))
  state.pending = [question([Q_STORE], { agentId: 'a5' })]
  p.load(state)
  const rows = () => findAll(p.view('PlanPage()'), v => v.t === 'button' && /^step /.test(v.p.class || ''))
  assert.equal(rows().length, 5)
  assert.equal(rows()[1].p['aria-expanded'], 'false')
  assert.match(textOf(rows()[1]), /needs you/)
  click(rows()[1])
  assert.equal(rows()[1].p['aria-expanded'], 'true')
  const [lead, helper] = find(find(p.view('PlanPage()'), 'step-body')[0], 'sa')
  assert.match(textOf(lead), /^Add jitter general-purpose done Edit src\/retry\/backoff-delays\.js 1\/2/)
  assert.deepEqual(find(lead, 'act-line').map(r => /file\d/.exec(textOf(r))[0]), ['file4', 'file3', 'file2'])
  assert.match(textOf(lead), /backoff-delays\.js backoff\.test\.js/)
  assert.ok(find(lead, 'sa-md')[0].p.class.includes('clamped'))
  assert.match(textOf(lead), /Show the whole result/)
  assert.deepEqual(find(lead, 'sec-link').map(a => [textOf(a), a.p.href]), [['Open agent', '#/agent/a84fbb5d74d874189'], ['Talk', '#/agent/a84fbb5d74d874189']])
  assert.match(textOf(helper), /^Jitter helper Explore · started by Add jitter running Read src\/retry\/index\.js/)
  assert.ok(helper.p.class.includes('sub'))
  assert.ok(find(find(helper, 'needs')[0], 'q-opt').every(o => o.t === 'button'), 'answerable right there')
  // Talk →: the agent page at Talk
  click(find(helper, 'sec-link')[1])
  assert.equal(p.run('ui.tabs.get("a5")'), 'talk')
  assert.deepEqual({ ...p.run('ui.scrollTo') }, { id: 'agent-tabs', on: 'agent:a5', until: NOW + 4000 })
})

test('a step the Orchestrator does itself shows its checklist item and what it just did; #/plan/<key> opens a step and scrolls to it; the goal bar`s segments open their steps', () => {
  const p = page({ hash: '#/plan/task%3A4' })
  const state = runState()
  state.plan.steps[3].status = 'active'
  state.agents[0].checklist.items[3] = { text: 'Test the jitter option', status: 'active', doing: 'Running the tests' }
  state.activity = [{ at: NOW - MIN, agent: 'main', tool: 'Bash', target: 'npm test', ok: null, ms: null }]
  p.load(state)
  p.run('followRoute()')
  assert.equal(p.run('ui.open.get("step|task:4")'), true)
  assert.equal(p.run('ui.scrollTo.id'), 'step-task:4')
  const step = byText(p.view('PlanPage()'), 'step-item', 'Test the jitter option')
  assert.equal(step.p.id, 'step-task:4')
  assert.match(textOf(find(step, 'sa')[0]), /^Orchestrator does this step itself running Test the jitter option Running the tests Bash npm test/)
  const segs = find(p.view('GoalCard()'), 'seg')
  assert.ok(segs.every(s => s.t === 'a'))
  assert.deepEqual(segs.map(s => s.p.href), ['#/plan/task%3A1', '#/plan/task%3A2', '#/plan/task%3A3', '#/plan/task%3A4', '#/plan/task%3A5'])
})

test('Review asks first ("It runs when Claude is free"), then shows what came of it', async () => {
  const p = page()
  p.load(runState())
  const review = () => p.view(`ReviewButton('changes', 'Review the diff')`)
  click(byText(review(), 'btn', 'Ask for review'))
  assert.equal(p.commands().length, 0, 'nothing is sent before you say yes')
  assert.equal(textOf(find(review(), 'confirm')[0]), 'Ask Claude to review these changes? It runs when Claude is free. Cancel Ask Claude')
  click(byText(review(), 'btn', 'Ask Claude'))
  await settle()
  const [cmd] = p.commands()
  assert.deepEqual(cmd, { cmd: 'review', id: cmd.id, text: 'Review the diff' })
  // what came of it shows where the confirm was, under the button: nothing beside it moves
  const note = () => textOf(find(review(), 'confirm-note')[0])
  assert.equal(note(), 'Sending…')
  p.load(runState({ acks: [{ id: cmd.id, ok: true, status: 'queued', text: 'It runs when Claude is free', at: NOW }] }))
  assert.equal(note(), 'Queued: it runs when Claude is free')
  assert.equal(find(review(), 'confirm').length, 1)
})
