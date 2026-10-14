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

/** A fresh page at `hash`, its clock at `now`: app.js in a context of its own. */
function page({ hash = '', now = NOW } = {}) {
  const noop = () => {}
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
    fetch: () => new Promise(noop),
    URLSearchParams,
  })
  vm.runInContext(SOURCE, context, { filename: 'app.js' })
  vm.runInContext(`Date.now = () => ${now}`, context)
  const run = js => vm.runInContext(js, context)
  return {
    run,
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
