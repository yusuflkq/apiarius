/**
 * A session well under way, built through the model's own recorders the way
 * the hooks module records a live one: the deck's model (DeckData), its git,
 * its usage and the questions the deck may answer, at a fixed `now`. The v2
 * fixture (web/fixtures/state.v2.json and web/fixtures/v2/, written by
 * web/fixtures/make-v2.mjs) is `W.deckStateOf` of it, and tests/v2.test.ts
 * reads it too.
 *
 * You asked for per-user rate limiting. The Orchestrator approved a plan
 * (ExitPlanMode), keeps a TodoWrite list and a task board, and runs a
 * release-check Workflow. Under it: builder works in the background (its
 * `npm test` waits on your permission), with tester done and a nameless
 * linter failed under it; researcher and docs are done and scout was
 * stopped; reviewer, a teammate, asks you a multi-select question while the
 * Orchestrator asks a single-choice one, and the github MCP server's
 * notification waits on you. builder and reviewer message each other, and
 * builder writes to ops-bot, a name no agent carries. Three sends from the
 * deck: delivered, queued, failed. Five files edited: src/rateLimit.ts by
 * builder and then tester (its off-by-one fixed, so git still counts the
 * file builder wrote), and builder's bench script outside the repository;
 * 15 tool calls, the linter's eslint call failed, builder's `npm test` and
 * the two questions still running. In the background (hooks/background.ts):
 * builder's dev server, the Orchestrator's CI monitor, a test watcher the
 * deck saw first in Claude Code's snapshot (no starter), the Orchestrator's
 * wakeup (its id from that snapshot) and its weekday cron; Claude Code's
 * permission check allows each TaskStop and CronDelete but the watcher's,
 * which it would ask you about.
 *
 * For Org's Timeline, as Claude Code reports a run: the Orchestrator's three
 * turns with idle between them (your prompt starts the first, tester's
 * task notification the last), its own calls (its board, the agents it
 * starts, TaskStop, the Workflow); researcher's and reviewer's searches;
 * tester's test run held on your permission for a minute and a half;
 * reviewer idle between its turns until builder's message woke it.
 *
 * Inspect (hooks/inspect.ts): the session runs in auto mode at high effort.
 * Auto mode refused builder's `git push --force` and your PreToolUse hook
 * blocked docs' edit of `.env` (two more calls, refused); your rule allowed
 * tester's `npm test`, you allowed builder's edit of src/app.ts in its
 * dialog, auto mode let scout's fetch through, builder's `npm test` waits on
 * you. The Orchestrator's context was compacted once (92% → 18%) and
 * researcher's once; /context's breakdown, two CLAUDE.md files and a nested
 * one, four memory files, 23 skills (two used), two MCP servers and two
 * hooks are loaded.
 *
 * Plain TypeScript that Node runs as it is (no `claude-code` import), so the
 * fixture's generator can load it.
 */
import type { DeckAgent, DeckData, DeckEdit, DeckQuestion } from '../types'
import * as B from '../hooks/background'
import { emptyGit, type GitState } from '../hooks/git'
import * as I from '../hooks/inspect'
import * as M from '../hooks/model'
import type { UsageInfo } from '../hooks/ui/types'
import { gitDiffIdOf, type GitDiffs } from '../hooks/web'

/** The moment the sample is built at (2026-10-14, 21:33 UTC). */
export const SAMPLE_NOW = 1_792_013_580_000

/** `n` minutes before the sample's now. */
export function ago(n: number): number {
  return SAMPLE_NOW - Math.round(n * 60_000)
}

export const ROOT = 'C:\\Users\\sam\\code\\acme-api'

/** The agents' ids, as the engine mints them. */
export const IDS = {
  researcher: 'a3f9c2e1b7d4058e',
  builder: 'b81c6f3e2a9d4c17',
  tester: 'c4d7e8f9a0b1263d',
  linter: 'd2e3f4a5b6c7089a',
  docs: 'e5f6a7b8c9d0142b',
  scout: 'f1e2d3c4b5a6978c',
  reviewer: 'aa11bb22cc33dd44',
} as const

export const QUESTION_ONE: DeckQuestion = {
  question: 'Which store should back the limiter in production?',
  header: 'Store',
  multiSelect: false,
  options: [
    { label: 'Redis', description: 'Shared across instances; needs REDIS_URL' },
    { label: 'In-memory', description: 'Per instance; resets on deploy' },
    { label: 'Postgres', description: 'Uses the existing database; slower' },
  ],
}

export const QUESTION_MANY: DeckQuestion = {
  question: 'Which routes should skip the limiter?',
  header: 'Exempt',
  multiSelect: true,
  options: [
    { label: '/health', description: 'The load balancer polls it every 5 s' },
    { label: '/metrics', description: 'Scraped by Prometheus' },
    { label: '/admin', description: 'Behind SSO already' },
  ],
}

const PROMPT =
  'Add per-user rate limiting to the public API. Use a sliding window, 100 requests per minute by default, configurable per route. Back it with Redis in production and an in-memory store in tests. Return 429 with Retry-After. Update the docs.'

const APPROVED = `# Rate limiting for the public API

1. **Map the routes.** Find every public route and how requests reach it.
2. **Write the limiter.** A sliding-window limiter in \`src/rateLimit.ts\`, 100 requests a minute by default, set per route.
3. **Two stores.** Redis in production (\`REDIS_URL\`), in memory in tests.
4. **Answer 429** with \`Retry-After\`, rounded up to the second.
5. **Docs.** The limits and the headers in \`docs/api.md\`.
`

const ANSWER = `Here is where things stand.

- **researcher** mapped the routes: 14 public ones, all through \`src/app.ts\`, so one middleware covers them.
- **builder** is writing the limiter in \`src/rateLimit.ts\` with a Redis store and an in-memory one; **tester** wrote its tests, and **linter** failed on a missing config, which builder is fixing.
- **docs** updated \`docs/api.md\` with the limits and the \`Retry-After\` header.
- **reviewer** joined as a teammate to review the limiter once builder is done.

I stopped **scout**: the Redis client's options were already in the researcher's report.

Two things are open: which store backs production, and which routes skip the limiter. I'll ask you about both.

${'Next, builder runs the limiter tests, which need your OK to run. '.repeat(3)}`

function patchOf(path: string, lines: string[], isNew = false, start = 1): string {
  // the hunk's counts as git writes them: the old side its context and removed lines, the new side its context and added lines
  const before = lines.filter(line => !line.startsWith('+')).length
  const after = lines.filter(line => !line.startsWith('-')).length
  const head = isNew ? `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n` : `--- a/${path}\n+++ b/${path}\n@@ -${start},${before} +${start},${after} @@\n`
  return `${head}${lines.join('\n')}\n`
}

/** A tool call made and ended in an agent's loop, `ms` long. */
function call(data: DeckData, agent: DeckAgent, id: string, tool: string, input: Record<string, unknown>, at: number, ms: number, ok = true) {
  M.beginTool(data, agent, M.activityOf(id, tool, input, ROOT, at))
  M.endTool(agent, id, ok, at + ms)
}

/** An agent's reads and searches, one a `[minutes ago, tool, target]`, each `ms` long: the ticks on its lane. */
function looks(data: DeckData, agent: DeckAgent, prefix: string, list: readonly (readonly [number, 'Read' | 'Grep' | 'Glob', string])[], ms = 400) {
  list.forEach(([minutes, tool, target], i) => {
    const input = tool === 'Read' ? { file_path: `${ROOT}\\${target.replace(/\//g, '\\')}` } : { pattern: target, path: `${ROOT}\\src` }
    call(data, agent, `${prefix}${i}`, tool, input, ago(minutes), ms)
  })
}

/** An edit an agent made, with its patch. */
function edit(data: DeckData, agent: DeckAgent, one: { id: string; tool: string; path: string; at: number; added: number; removed: number; patch: string; isNew?: boolean }) {
  const made: DeckEdit = { id: one.id, agent: agent.id, tool: one.tool, path: one.path, abs: /^[A-Za-z]:\\/.test(one.path) ? one.path : `${ROOT}\\${one.path.replace(/\//g, '\\')}`, at: one.at, added: one.added, removed: one.removed, patch: one.patch, isNew: one.isNew === true }
  M.addEdit(data, agent, made)
}

/** A spawn as the engine reports it, its task handed down as a message. */
function spawn(data: DeckData, one: { toolUseId: string; agentId: string; parentId: string; name: string; description: string; prompt: string; type: string; background: boolean; isTeammate?: boolean; model: string; at: number }): DeckAgent {
  const { agent } = M.noteSpawn(data, { ...one, isTeammate: one.isTeammate === true })
  M.addMessage(data, { from: one.parentId, to: agent.id, kind: 'spawn', text: one.prompt, at: one.at })
  return agent
}

/** A call that starts background work, started and ended as the hooks module records it, with Claude Code's result. */
function background(data: DeckData, call: B.Call, result: Record<string, unknown>) {
  B.noteStart(data, call)
  B.noteEnd(data, { ...call, ok: true, result })
}

export type V2Session = { data: DeckData; git: GitState; usage: UsageInfo; now: number; sessionId: string; cwd: string; answerable: Set<string>; gitDiffs: GitDiffs }

/** Git's own diff of each uncommitted file, as the mod reads them (hunks whole, `W.gitDiffTextOf`'s form), by path, with their ids. */
function gitDiffsOf(texts: Record<string, string[]>): GitDiffs {
  return new Map(
    Object.entries(texts).map(([path, lines]) => {
      const text = `${lines.join('\n')}\n`
      return [path, { id: gitDiffIdOf(path, text), text }]
    }),
  )
}

export function v2Session(): V2Session {
  const data = M.emptyData(ago(42))
  const main = M.agentOf(data, M.MAIN) as DeckAgent
  Object.assign(main, { status: 'running', model: 'claude-opus-5-5', tokensIn: 182_400, tokensOut: 21_300, cacheRead: 1_204_000, requests: 31 })
  // the classic hooks name the mode and the effort: auto mode, high
  I.noteMode(data, { permission_mode: 'auto', effort: { level: 'high' } })

  // you asked; the main loop's turn runs since
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: PROMPT, at: ago(40) })
  M.noteGoal(data, 'goal', { text: PROMPT, origin: 'composer', at: ago(40) })
  M.noteMainTurn(data, 'turn-1a0f', ago(40))

  // the plan, as Claude made it: approved (ExitPlanMode), its own TodoWrite list, its task board, a Workflow's phases
  M.noteApproved(data, APPROVED, M.MAIN, ago(38))
  call(data, main, 'toolu_01TodoA', 'TodoWrite', {}, ago(37), 200)
  M.noteTodos(
    main,
    [
      { content: 'Map the public routes', status: 'completed', activeForm: 'Mapping the public routes' },
      { content: 'Write the limiter and its stores', status: 'in_progress', activeForm: 'Writing the limiter and its stores' },
      { content: 'Answer 429 with Retry-After', status: 'pending', activeForm: 'Answering 429 with Retry-After' },
      { content: 'Update the docs', status: 'completed', activeForm: 'Updating the docs' },
    ],
    ago(14),
  )
  for (const [id, subject, form] of [
    ['1', 'Map the public routes', 'Mapping the routes'],
    ['2', 'Write the sliding-window limiter', 'Writing the limiter'],
    ['3', 'Review the limiter', 'Reviewing the limiter'],
  ] as const) {
    call(data, main, `toolu_01Task${id}`, 'TaskCreate', { subject, description: subject, activeForm: form }, ago(36.2) + Number(id) * 3000, 150)
    M.noteBoard(data, main, 'TaskCreate', { subject, description: subject, activeForm: form }, { task: { id, subject } }, ago(36))
  }
  M.noteBoard(data, main, 'TaskUpdate', { taskId: '1', status: 'completed', owner: 'researcher' }, { success: true }, ago(30))
  M.noteBoard(data, main, 'TaskUpdate', { taskId: '2', status: 'in_progress', owner: 'builder' }, { success: true }, ago(29))
  M.noteBoard(data, main, 'TaskUpdate', { taskId: '3', owner: 'reviewer' }, { success: true }, ago(10))
  M.noteWorkflow(data, { id: 'toolu_01WfRel', caller: M.MAIN, name: 'release-check', phases: ['Lint', 'Unit tests', 'Package'], at: ago(5) })

  // researcher: a foreground Explore agent, done, its hand-back the result
  const researcher = spawn(data, {
    toolUseId: 'toolu_01SpRes',
    agentId: IDS.researcher,
    parentId: M.MAIN,
    name: 'researcher',
    description: 'Map the API routes',
    prompt: 'Find every public route of the API, how a request reaches it (middleware order in src/app.ts), and any limiter or throttle already there. Report the routes as a list with their handlers.',
    type: 'Explore',
    background: false,
    model: 'claude-haiku-4-5-20251001',
    at: ago(35),
  })
  // the Orchestrator's Agent call waits on its foreground agent until it hands back
  call(data, main, 'toolu_01SpRes', 'Agent', { description: 'Map the API routes', subagent_type: 'Explore' }, ago(35), 4 * 60_000)
  call(data, researcher, 'toolu_01ResG1', 'Grep', { pattern: 'router\\.(get|post)', path: `${ROOT}\\src` }, ago(34), 900)
  call(data, researcher, 'toolu_01ResR1', 'Read', { file_path: `${ROOT}\\src\\app.ts` }, ago(33), 300)
  // more calls than the deck keeps whole (14): the timeline keeps each one's start
  looks(data, researcher, 'toolu_01ResL', [
    [34.8, 'Glob', 'src/**/*.ts'],
    [34.6, 'Read', 'src/routes/index.ts'],
    [34.45, 'Read', 'src/routes/health.ts'],
    [34.3, 'Read', 'src/routes/metrics.ts'],
    [33.8, 'Read', 'src/routes/users.ts'],
    [33.6, 'Read', 'src/routes/orders.ts'],
    [33.45, 'Read', 'src/routes/admin.ts'],
    [33.3, 'Grep', 'app\\.use\\('],
    [32.8, 'Grep', 'throttle|rateLimit'],
    [32.6, 'Read', 'src/auth.ts'],
    [32.4, 'Read', 'src/middleware/index.ts'],
    [32.2, 'Read', 'package.json'],
    [32.0, 'Grep', 'ioredis'],
    [31.8, 'Read', 'src/redis.ts'],
    [31.6, 'Glob', 'tests/**/*.ts'],
    [31.4, 'Read', 'README.md'],
  ])
  M.noteResult(data, researcher, 'Found 14 public routes, all mounted in `src/app.ts` after `auth()`. No limiter exists. The Redis client (`ioredis`) is already a dependency.', ago(31), 'handback')
  Object.assign(researcher, { status: 'completed', endedAt: ago(31), tokensIn: 41_000, tokensOut: 2_100, cacheRead: 88_000, requests: 6 })

  // the Orchestrator's answer to you: long, so its whole text is a lazy file
  M.addMessage(data, { from: M.MAIN, to: M.YOU, kind: 'answer', text: ANSWER, at: ago(30) })
  M.noteMainAnswer(main, ANSWER)
  // its first turn ends with that answer; the next starts within the minute
  M.endMainTurn(data, 'turn-1a0f', ago(30))
  M.noteMainTurn(data, 'turn-3b5d', ago(29.5))

  // builder: in the background, at work; tester and the nameless linter under it
  const builder = spawn(data, {
    toolUseId: 'toolu_01SpBld',
    agentId: IDS.builder,
    parentId: M.MAIN,
    name: 'builder',
    description: 'Write the limiter and its stores',
    prompt: 'Write a sliding-window rate limiter in src/rateLimit.ts: 100 requests a minute per user by default, set per route. A Redis store (REDIS_URL) and an in-memory one for tests. Answer 429 with Retry-After. Mount it in src/app.ts after auth().',
    type: 'general-purpose',
    background: true,
    model: 'claude-sonnet-4-5',
    at: ago(29),
  })
  call(data, main, 'toolu_01SpBld', 'Agent', { description: 'Write the limiter and its stores', run_in_background: true }, ago(29), 1_200)
  Object.assign(builder, { tokensIn: 96_000, tokensOut: 14_800, cacheRead: 402_000, requests: 18 })
  call(data, builder, 'toolu_01BldW1', 'Write', { file_path: `${ROOT}\\src\\rateLimit.ts` }, ago(27), 400)
  edit(data, builder, {
    id: 'toolu_01BldW1',
    tool: 'Write',
    path: 'src/rateLimit.ts',
    at: ago(27),
    added: 6,
    removed: 0,
    isNew: true,
    // with an off-by-one tester's tests find: `<` refuses the 100th request
    patch: patchOf('src/rateLimit.ts', ['+export type Store = { hit(key: string, now: number): Promise<number> }', '+', '+export function limiter(store: Store, perMinute = 100) {', '+  return async (key: string, now = Date.now()) => (await store.hit(key, now)) < perMinute', '+}', '+'], true),
  })
  call(data, builder, 'toolu_01BldE1', 'Edit', { file_path: `${ROOT}\\src\\app.ts` }, ago(24), 300)
  edit(data, builder, {
    id: 'toolu_01BldE1',
    tool: 'Edit',
    path: 'src/app.ts',
    at: ago(24),
    added: 2,
    removed: 1,
    patch: patchOf('src/app.ts', [" import { auth } from './auth'", "+import { limiter } from './rateLimit'", ' app.use(auth())', '-app.use(routes)', '+app.use(limit(limiter(store)), routes)']),
  })
  // auto mode refused its force-push (Inspect's permissions): a call refused
  call(data, builder, 'toolu_01BldB1', 'Bash', FORCE_PUSH, ago(13), 900, false)
  call(data, builder, 'toolu_01BldW2', 'Write', { file_path: 'C:\\Users\\sam\\AppData\\Local\\Temp\\bench.js' }, ago(11), 200)
  edit(data, builder, {
    id: 'toolu_01BldW2',
    tool: 'Write',
    path: 'C:\\Users\\sam\\AppData\\Local\\Temp\\bench.js',
    at: ago(11),
    added: 3,
    removed: 0,
    isNew: true,
    patch: patchOf('bench.js', ["+const { limiter } = require('./rateLimit')", '+// 10,000 hits against the in-memory store', '+'], true),
  })
  data.commitsBy['9c1e4b7a2f58d03e6b1c47f9a2d8e5b0c3f6a914'] = IDS.builder

  const tester = spawn(data, {
    toolUseId: 'toolu_01SpTst',
    agentId: IDS.tester,
    parentId: IDS.builder,
    name: 'tester',
    description: 'Write the limiter tests',
    prompt: 'Write tests for src/rateLimit.ts against the in-memory store: the window slides, a burst past the limit is refused, Retry-After rounds up.',
    type: 'general-purpose',
    background: false,
    model: 'claude-haiku-4-5-20251001',
    at: ago(22),
  })
  call(data, tester, 'toolu_01TstW1', 'Write', { file_path: `${ROOT}\\tests\\rateLimit.test.ts` }, ago(20), 300)
  edit(data, tester, {
    id: 'toolu_01TstW1',
    tool: 'Write',
    path: 'tests/rateLimit.test.ts',
    at: ago(20),
    added: 4,
    removed: 0,
    isNew: true,
    patch: patchOf('tests/rateLimit.test.ts', ["+import { limiter } from '../src/rateLimit'", "+test('a burst past the limit is refused', async () => {", '+  expect(await burst(101)).toBe(false)', '+})'], true),
  })
  // its tests found builder's off-by-one: tester fixes it in builder's file, which two agents have edited since
  call(data, tester, 'toolu_01TstE1', 'Edit', { file_path: `${ROOT}\\src\\rateLimit.ts` }, ago(19), 250)
  edit(data, tester, {
    id: 'toolu_01TstE1',
    tool: 'Edit',
    path: 'src/rateLimit.ts',
    at: ago(19),
    added: 1,
    removed: 1,
    patch: patchOf(
      'src/rateLimit.ts',
      [
        ' export function limiter(store: Store, perMinute = 100) {',
        '-  return async (key: string, now = Date.now()) => (await store.hit(key, now)) < perMinute',
        '+  return async (key: string, now = Date.now()) => (await store.hit(key, now)) <= perMinute',
        ' }',
      ],
      false,
      3,
    ),
  })
  looks(data, tester, 'toolu_01TstL', [
    [21.6, 'Read', 'src/rateLimit.ts'],
    [21.2, 'Glob', 'tests/**/*.test.ts'],
    [19.6, 'Read', 'tests/app.test.ts'],
  ])
  // its test run waits on your permission for a minute and a half, then runs
  const tests = { command: 'npm test -- rateLimit --runInBand', description: 'Run the limiter tests' }
  M.beginTool(data, tester, M.activityOf('toolu_01TstB1', 'Bash', tests, ROOT, ago(16)))
  M.notePending(data, M.permissionOf({ id: 'toolu_01TstB1', tool: 'Bash', input: tests, agentId: IDS.tester, at: ago(15.9) }, ROOT))
  M.dropPending(data, 'toolu_01TstB1')
  M.endTool(tester, 'toolu_01TstB1', true, ago(14.4))
  M.noteResult(data, tester, 'Wrote 6 tests in `tests/rateLimit.test.ts`; all pass against the in-memory store.', ago(12), 'handback')
  Object.assign(tester, { status: 'completed', endedAt: ago(12), tokensIn: 22_000, tokensOut: 3_900, cacheRead: 51_000, requests: 5 })
  M.addMessage(data, { from: M.ENGINE, to: M.MAIN, kind: 'task', title: 'completed', text: 'Agent "Write the limiter tests" completed', at: ago(12), agent: IDS.tester })

  const linter = spawn(data, {
    toolUseId: 'toolu_01SpLnt',
    agentId: IDS.linter,
    parentId: IDS.builder,
    name: '',
    description: 'Lint the new files',
    prompt: 'Run eslint on src/rateLimit.ts and src/app.ts and fix what it reports.',
    type: 'Explore',
    background: false,
    model: 'claude-haiku-4-5-20251001',
    at: ago(19),
  })
  call(data, linter, 'toolu_01LntB1', 'Bash', { command: 'npx eslint src/rateLimit.ts src/app.ts', description: 'Lint the new files' }, ago(18), 2_100, false)
  Object.assign(linter, { status: 'failed', endedAt: ago(17), tokensIn: 9_000, tokensOut: 600, cacheRead: 12_000, requests: 2 })

  // docs: done; scout: stopped (TaskStop)
  const docs = spawn(data, {
    toolUseId: 'toolu_01SpDoc',
    agentId: IDS.docs,
    parentId: M.MAIN,
    name: 'docs',
    description: 'Update the API docs',
    prompt: 'Document the limits and the 429 answer with its Retry-After header in docs/api.md.',
    type: 'general-purpose',
    background: false,
    model: 'claude-haiku-4-5-20251001',
    at: ago(26),
  })
  call(data, main, 'toolu_01SpDoc', 'Agent', { description: 'Update the API docs' }, ago(26), 5 * 60_000)
  looks(data, docs, 'toolu_01DocL', [
    [25.6, 'Read', 'docs/api.md'],
    [25.1, 'Grep', 'Retry-After'],
    [24.4, 'Read', 'src/rateLimit.ts'],
  ])
  call(data, docs, 'toolu_01DocE1', 'Edit', { file_path: `${ROOT}\\docs\\api.md` }, ago(23), 250)
  // your PreToolUse hook blocked its edit of .env (Inspect's permissions)
  call(data, docs, 'toolu_01DocE0', 'Edit', { file_path: `${ROOT}\\.env` }, ago(22.5), 120, false)
  edit(data, docs, {
    id: 'toolu_01DocE1',
    tool: 'Edit',
    path: 'docs/api.md',
    at: ago(23),
    added: 3,
    removed: 1,
    patch: patchOf('docs/api.md', [' ## Limits', '-None yet.', '+Each user may make 100 requests a minute; a route may set its own limit.', '+Past it the API answers `429 Too Many Requests` with `Retry-After`, in seconds.', '+']),
  })
  M.noteResult(data, docs, 'Documented the limits and the `Retry-After` header in `docs/api.md`.', ago(21), 'handback')
  Object.assign(docs, { status: 'completed', endedAt: ago(21), tokensIn: 12_000, tokensOut: 1_800, cacheRead: 30_000, requests: 3 })

  const scout = spawn(data, {
    toolUseId: 'toolu_01SpSct',
    agentId: IDS.scout,
    parentId: M.MAIN,
    name: 'scout',
    description: 'Check the Redis client options',
    prompt: "Read ioredis's options and say which matter for a limiter: retries, timeouts, the key prefix.",
    type: 'Explore',
    background: true,
    model: 'claude-haiku-4-5-20251001',
    at: ago(25),
  })
  call(data, main, 'toolu_01SpSct', 'Agent', { description: 'Check the Redis client options', run_in_background: true }, ago(25), 1_100)
  call(data, scout, 'toolu_01SctF1', 'WebFetch', { url: 'https://github.com/redis/ioredis#readme' }, ago(24), 1_800)
  call(data, main, 'toolu_01StopSct', 'TaskStop', { task_id: IDS.scout }, ago(22), 600)
  Object.assign(scout, { status: 'killed', endedAt: ago(22), tokensIn: 6_000, tokensOut: 300, cacheRead: 9_000, requests: 2 })
  // the Orchestrator's second turn ends once docs handed back; tester's task notification (12 minutes ago) starts its third
  M.endMainTurn(data, 'turn-3b5d', ago(20.5))
  M.noteMainTurn(data, 'turn-7c1e', ago(12))

  // reviewer: a teammate, at work; builder and it write to each other (SendMessage, titled by its summary)
  const reviewer = spawn(data, {
    toolUseId: 'toolu_01SpRev',
    agentId: IDS.reviewer,
    parentId: M.MAIN,
    name: 'reviewer',
    description: 'Review the limiter',
    prompt: 'Review src/rateLimit.ts once builder says it is ready: correctness of the window, the Redis keys, the 429 answer.',
    type: 'code-reviewer',
    background: true,
    isTeammate: true,
    model: 'claude-opus-5-5',
    at: ago(10),
  })
  Object.assign(reviewer, { tokensIn: 30_000, tokensOut: 2_200, cacheRead: 64_000, requests: 4 })
  // reviewer reads its task, then idles between its turns (TeammateIdle) until builder's message wakes it
  M.noteIdle(data, { id: IDS.reviewer, name: 'reviewer' }, ago(9.6))

  M.addMessage(data, { from: IDS.builder, to: IDS.reviewer, kind: 'message', title: 'Limiter ready for review', text: '`src/rateLimit.ts` and both stores are in. The tests pass against the in-memory store; the Redis one needs a server.', at: ago(9), isDelivered: true })
  M.reopen(reviewer, ago(8.9))
  looks(data, reviewer, 'toolu_01RevB', [
    [8.6, 'Read', 'src/rateLimit.ts'],
    [6.9, 'Grep', 'Retry-After'],
    [4.8, 'Read', 'tests/rateLimit.test.ts'],
    [3.4, 'Grep', 'Math\\.ceil'],
  ])
  M.addMessage(data, { from: IDS.reviewer, to: IDS.builder, kind: 'message', title: 'Two questions on the window', text: 'Why a sliding log rather than a sliding-window counter? And does `Retry-After` round up?', at: ago(7), isDelivered: true })
  M.addMessage(data, { from: IDS.builder, to: 'ops-bot', kind: 'message', title: 'A Redis for CI', text: 'Can CI start a Redis service for the limiter tests?', at: ago(6) })

  // three sends from the deck: delivered to builder (and its words after), queued for the Orchestrator, failed for the linter that had ended
  M.addMessage(data, { from: M.YOU, to: IDS.linter, kind: 'chat', text: 'Use the repo’s .eslintrc, not the default.', at: ago(16), isDelivered: false, ackId: 'c-1' })
  M.noteAck(data, { id: 'c-1', ok: false, status: 'failed', text: 'Not delivered: it has ended', at: ago(16) })
  M.addMessage(data, { from: M.YOU, to: IDS.builder, kind: 'chat', text: 'Keep the Redis store optional: the tests must run without it.', at: ago(8), isDelivered: true, ackId: 'c-2' })
  M.noteAck(data, { id: 'c-2', ok: true, status: 'delivered', text: 'It reads it at its next step', at: ago(8) })
  M.addMessage(data, { from: IDS.builder, to: '', kind: 'chat', text: 'Will do: the store is picked by REDIS_URL, in memory without it.', at: ago(7.5) })
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'chat', text: 'Also exempt /health and /metrics from the limiter.', at: ago(4), ackId: 'c-3' })
  M.noteAck(data, { id: 'c-3', ok: true, status: 'queued', text: 'Claude reads it when it finishes its current turn', at: ago(4) })

  // what needs you: the Orchestrator's question, reviewer's multi-select one, builder's permission prompt, the github server's notification
  M.beginTool(data, main, M.activityOf('toolu_01AskOne', 'AskUserQuestion', { questions: [QUESTION_ONE] }, ROOT, ago(3)))
  M.notePending(data, { id: 'toolu_01AskOne', agentId: M.MAIN, kind: 'question', tool: 'AskUserQuestion', at: ago(3), questions: [QUESTION_ONE] })
  M.addMessage(data, { from: M.MAIN, to: M.YOU, kind: 'question', text: M.questionsTextOf([QUESTION_ONE]), at: ago(3), callId: 'toolu_01AskOne' })

  const test = { command: 'npm test -- rateLimit', description: 'Run the limiter tests' }
  M.beginTool(data, builder, M.activityOf('toolu_01BldB2', 'Bash', test, ROOT, ago(2.5)))
  M.notePending(data, M.permissionOf({ id: 'toolu_01BldB2', tool: 'Bash', input: test, agentId: IDS.builder, at: ago(2.5) }, ROOT))
  // Claude Code's own notification of that prompt: a chat row, and no second need
  M.noteNotification(data, { type: 'permission_prompt', message: 'Claude needs your permission to use Bash', title: 'Permission needed', agent: IDS.builder, at: ago(2.4) })

  M.beginTool(data, reviewer, M.activityOf('toolu_01AskMany', 'AskUserQuestion', { questions: [QUESTION_MANY] }, ROOT, ago(2)))
  M.notePending(data, { id: 'toolu_01AskMany', agentId: IDS.reviewer, kind: 'question', tool: 'AskUserQuestion', at: ago(2), questions: [QUESTION_MANY] })
  M.addMessage(data, { from: IDS.reviewer, to: M.YOU, kind: 'question', text: M.questionsTextOf([QUESTION_MANY]), at: ago(2), callId: 'toolu_01AskMany' })

  M.noteNotification(data, { type: 'elicitation_dialog', message: 'The github MCP server is asking for your input', title: 'github', at: ago(1) })

  // what runs when no agent is talking: builder's dev server, the Orchestrator's CI monitor, its wakeup and its weekday cron
  background(data, { toolUseId: 'toolu_01BgDev', tool: 'Bash', input: { command: 'npm run dev', description: 'Start the dev server', run_in_background: true }, by: IDS.builder, at: ago(18) }, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bash_7' })
  background(data, { toolUseId: 'toolu_01BgMon', tool: 'Monitor', input: { description: 'CI checks on PR 42', command: 'gh pr checks 42 --watch', timeout_ms: 1_800_000 }, by: M.MAIN, at: ago(3.5) }, { taskId: 'mon_2', timeoutMs: 1_800_000 })
  background(data, { toolUseId: 'toolu_01BgWake', tool: 'ScheduleWakeup', input: { delaySeconds: 1200, reason: 'Check the deploy finished', prompt: '/loop check the deploy' }, by: M.MAIN, at: ago(1.5) }, { scheduledFor: ago(-18.5), clampedDelaySeconds: 1200, wasClamped: false })
  background(data, { toolUseId: 'toolu_01BgCron', tool: 'CronCreate', input: { cron: '0 9 * * 1-5', prompt: "Summarise yesterday's PRs", recurring: true }, by: M.MAIN, at: ago(1.2) }, { id: 'cron_4e1', humanSchedule: 'Every weekday at 9:00', recurring: true, nextFireAt: ago(-(11 * 60 + 27)) })
  // Claude Code's snapshot as builder's last step stopped: it lists a test watcher the deck never saw start, and names the wakeup
  B.noteSnapshot(data, {
    tasks: [
      { id: 'bash_7', type: 'shell', status: 'running', description: 'Start the dev server', command: 'npm run dev' },
      { id: 'mon_2', type: 'monitor', status: 'running', description: 'CI checks on PR 42' },
      { id: 'bash_3', type: 'shell', status: 'running', description: 'Watch the limiter tests', command: 'npx vitest --watch' },
      { id: IDS.builder, type: 'subagent', status: 'running', description: 'Write the limiter and its stores', agent_type: 'general-purpose' },
    ],
    crons: [
      { id: 'cron_4e1', schedule: '0 9 * * 1-5', recurring: true, prompt: "Summarise yesterday's PRs" },
      { id: 'wake_9c2', schedule: '54 21 14 10 *', recurring: false, prompt: '/loop check the deploy' },
    ],
    at: ago(0.8),
    agents: new Set(data.agents.map(one => one.id)),
  })
  // Claude Code's permission check on each stopping call the deck could make: TaskStop and CronDelete allowed, but for the watcher, which it would ask you about
  for (const call of B.stopCallsOf(data)) B.noteVerdict(data, call.key, call.id === 'bash_3' ? { decision: 'ask' } : { decision: 'allow' }, ago(0.5))

  inspectOf(data)

  const git: GitState = {
    ...emptyGit(),
    isRepo: true,
    root: ROOT,
    branch: 'feat/rate-limit',
    head: '9c1e4b7a2f58d03e6b1c47f9a2d8e5b0c3f6a914',
    upstream: 'origin/feat/rate-limit',
    ahead: 1,
    behind: 0,
    files: [
      { path: 'src/app.ts', code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 2, removed: 1 },
      { path: 'src/rateLimit.ts', code: 'N', isStaged: false, isUnstaged: false, isUntracked: true, isBinary: false, added: 6, removed: 0 },
      { path: 'tests/rateLimit.test.ts', code: 'N', isStaged: false, isUnstaged: false, isUntracked: true, isBinary: false, added: 4, removed: 0 },
      { path: 'docs/api.md', code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 3, removed: 1 },
      { path: 'package.json', code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 1, removed: 0 },
    ],
    added: 16,
    removed: 2,
    commits: [{ hash: '9c1e4b7a2f58d03e6b1c47f9a2d8e5b0c3f6a914', short: '9c1e4b7', author: 'sam', at: ago(15), subject: 'Add the sliding-window limiter', files: 1, added: 6, removed: 0 }],
    checkedAt: ago(0.2),
  }
  // git's own diff of each: the agents' edits as they landed, and package.json's line no agent's edit holds
  const gitDiffs = gitDiffsOf({
    'src/app.ts': ['@@ -1,3 +1,4 @@', " import { auth } from './auth'", "+import { limiter } from './rateLimit'", ' app.use(auth())', '-app.use(routes)', '+app.use(limit(limiter(store)), routes)'],
    'src/rateLimit.ts': [
      '@@ -0,0 +1,6 @@',
      '+export type Store = { hit(key: string, now: number): Promise<number> }',
      '+',
      '+export function limiter(store: Store, perMinute = 100) {',
      '+  return async (key: string, now = Date.now()) => (await store.hit(key, now)) <= perMinute',
      '+}',
      '+',
    ],
    'tests/rateLimit.test.ts': ['@@ -0,0 +1,4 @@', "+import { limiter } from '../src/rateLimit'", "+test('a burst past the limit is refused', async () => {", '+  expect(await burst(101)).toBe(false)', '+})'],
    'docs/api.md': [
      '@@ -12,2 +12,4 @@',
      ' ## Limits',
      '-None yet.',
      '+Each user may make 100 requests a minute; a route may set its own limit.',
      '+Past it the API answers `429 Too Many Requests` with `Retry-After`, in seconds.',
      '+',
    ],
    'package.json': ['@@ -8,4 +8,5 @@', '   "dependencies": {', '     "express": "^4.19.2",', '+    "ioredis": "^5.4.1",', '     "zod": "^3.23.8"', '   },'],
  })
  const usage: UsageInfo = { startedAt: ago(42), contextPercent: 41, costUsd: 4.12, limits: [] }
  return { data, git, usage, now: SAMPLE_NOW, sessionId: '5f2c8a1e-7b3d-4c9a-9e61-2d4f8b0c3a17', cwd: ROOT, answerable: new Set(['toolu_01AskOne', 'toolu_01AskMany']), gitDiffs }
}

/** builder's force-push, which auto mode refused. */
const FORCE_PUSH = { command: 'git push --force origin main', description: 'Push the limiter' }

/** The Orchestrator's compaction's summary, as the engine's first message after it reads: long, so its whole text is a lazy file. */
const SUMMARY = `This session is being continued from a previous conversation that ran out of context. The conversation is summarized below.

1. **Request.** Per-user rate limiting for the public API: a sliding window, 100 requests a minute by default, set per route; Redis in production, in memory in tests; 429 with Retry-After; the docs updated.
2. **Plan.** Approved: map the routes, write the limiter in \`src/rateLimit.ts\`, two stores, answer 429, the docs.
3. **Done so far.** researcher mapped 14 public routes, all mounted in \`src/app.ts\` after \`auth()\`. docs updated \`docs/api.md\`. builder wrote the limiter; tester's tests pass against the in-memory store; the linter failed on a missing config.
4. **Open.** Which store backs production; which routes skip the limiter.
${'Next: wait for builder, then run the limiter tests. '.repeat(3)}`

/**
 * What Inspect heard in the sample session (hooks/inspect.ts): every
 * permission decision on the calls above, oldest first, with how each ask
 * was settled and how its call ended; the two compactions; /context's
 * breakdown; the instruction and memory files; the model, the output style
 * and the settings' hooks; two skills and four MCP calls used.
 */
function inspectOf(data: DeckData): void {
  const at = (n: number) => ago(n)
  // /context's breakdown, read last: the window the Orchestrator's compaction is counted against
  I.noteBreakdown(
    data,
    {
      categories: [
        { name: 'System prompt', tokens: 3_100, kind: 'used', color: 'promptBorder' },
        { name: 'System tools', tokens: 12_400, kind: 'used', color: 'inactive' },
        { name: 'MCP tools', tokens: 8_200, kind: 'used', color: 'cyan_FOR_SUBAGENTS_ONLY' },
        { name: 'Memory files', tokens: 2_600, kind: 'used', color: 'claude' },
        { name: 'Skills', tokens: 1_900, kind: 'used', color: 'warning' },
        { name: 'Messages', tokens: 54_000, kind: 'used', color: 'purple_FOR_SUBAGENTS_ONLY' },
        { name: 'Free space', tokens: 84_800, kind: 'free', color: 'promptBorder' },
        { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer', color: 'inactive' },
        { name: 'MCP tools (deferred)', tokens: 4_100, kind: 'deferred', color: 'inactive' },
      ],
      totalTokens: 82_200,
      rawMaxTokens: 200_000,
      percentage: 41,
      model: 'claude-opus-5-5',
      memoryFiles: [
        { path: 'C:\\Users\\sam\\.claude\\CLAUDE.md', type: 'User', tokens: 310 },
        { path: `${ROOT}\\CLAUDE.md`, type: 'Project', tokens: 1_480 },
        { path: `${ROOT}\\src\\CLAUDE.md`, type: 'Project', tokens: 240 },
        { path: 'C:\\Users\\sam\\.claude\\projects\\acme-api\\memory\\MEMORY.md', type: 'AutoMem', tokens: 160 },
        { path: 'C:\\Users\\sam\\.claude\\projects\\acme-api\\memory\\redis-in-ci.md', type: 'AutoMem', tokens: 140 },
        { path: 'C:\\Users\\sam\\.claude\\projects\\acme-api\\memory\\api-conventions.md', type: 'AutoMem', tokens: 180 },
        { path: 'C:\\Users\\sam\\.claude\\projects\\acme-api\\memory\\ask-before-pushing.md', type: 'AutoMem', tokens: 90 },
      ],
      mcpTools: [
        ...['get_pull_request', 'list_checks', 'create_issue', 'list_issues', 'get_file', 'search_code', 'create_branch', 'list_commits', 'get_workflow_run', 'add_comment', 'merge_pull_request', 'list_pull_requests'].map((tool, i) => ({ name: `mcp__github__${tool}`, serverName: 'github', tokens: 520, isLoaded: i < 10 })),
        ...['search_issues', 'get_issue', 'create_issue', 'update_issue', 'list_projects', 'list_teams', 'add_comment', 'get_user'].map(tool => ({ name: `mcp__linear__${tool}`, serverName: 'linear', tokens: 380, isLoaded: false })),
      ],
      skills: {
        totalSkills: 23,
        skillFrontmatter: ['code-review', 'run', 'simplify', 'security-review', 'init', 'loop', 'schedule', 'update-config', 'keybindings-help', 'fewer-permission-prompts', 'claude-api', 'dataviz', 'pdf', 'docx', 'xlsx', 'pptx', 'humanizer', 'skill-creator', 'artifact-design', 'workflow-authoring', 'plugin-authoring', 'watch-video', 'ask'].map(name => ({ name })),
      },
      autoCompactThreshold: 166_000,
      isAutoCompactEnabled: true,
    },
    200_000,
    at(0.5),
  )
  // the instruction files the conversation carries (prompt.context), and why each loaded (InstructionsLoaded)
  I.noteInstructions(
    data,
    [
      { path: 'C:\\Users\\sam\\.claude\\CLAUDE.md', kind: 'user', content: ['# Mine', '', '- Plain English in docs.', '- Ask before pushing.', '- Tests before commits.', '- No new dependencies unasked.'].join('\n') },
      { path: `${ROOT}\\CLAUDE.md`, kind: 'project', content: Array.from({ length: 41 }, (_, i) => `Line ${i + 1} of the project's notes.`).join('\n') },
    ],
    at(42),
  )
  I.noteInstructionLoaded(data, { path: 'C:\\Users\\sam\\.claude\\CLAUDE.md', memoryType: 'User', reason: 'session_start' }, at(42))
  I.noteInstructionLoaded(data, { path: `${ROOT}\\CLAUDE.md`, memoryType: 'Project', reason: 'session_start' }, at(42))
  I.noteInstructionLoaded(data, { path: `${ROOT}\\src\\CLAUDE.md`, memoryType: 'Project', reason: 'nested_traversal', trigger: `${ROOT}\\src\\app.ts` }, at(33))
  // the model, the output style and the settings' hooks (the project's PreToolUse guard, your Stop chime)
  I.noteLoaded(
    data,
    {
      model: 'claude-opus-5-5',
      outputStyle: 'default',
      hooks: [
        ...I.hooksOf({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'powershell -c (New-Object Media.SoundPlayer chimes.wav).PlaySync()' }] }] } }, 'user'),
        ...I.hooksOf({ hooks: { PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node .claude/hooks/protect-secrets.js' }] }] } }, 'project'),
      ],
    },
    at(42),
  )
  // two skills the Skill tool ran, and the github server's tools called four times
  I.noteCall(data, 'Skill', { skill: 'code-review' }, at(9))
  I.noteCall(data, 'Skill', { skill: 'run' }, at(17))
  for (const tool of ['mcp__github__get_pull_request', 'mcp__github__get_pull_request', 'mcp__github__get_pull_request', 'mcp__github__list_checks']) I.noteCall(data, tool, {}, at(6))

  // every permission decision, oldest first: the verdict, how an ask was settled, how the call ended
  const check = (id: string, agentId: string, tool: string, input: Record<string, unknown>, minutes: number, verdict: I.CheckIn['verdict']) => I.noteCheck(data, { id, tool, input, agentId, verdict, approver: 'person', at: at(minutes), root: ROOT })
  check('toolu_01BldW1', IDS.builder, 'Write', { file_path: `${ROOT}\\src\\rateLimit.ts` }, 27, { decision: 'allow' })
  I.noteEnd(data, 'toolu_01BldW1', true)
  check('toolu_01BldE1', IDS.builder, 'Edit', { file_path: `${ROOT}\\src\\app.ts` }, 24, { decision: 'ask' })
  I.noteDialog(data, 'toolu_01BldE1')
  I.noteEnd(data, 'toolu_01BldE1', true)
  check('toolu_01SctF1', IDS.scout, 'WebFetch', { url: 'https://github.com/redis/ioredis#readme' }, 24, { decision: 'ask' })
  I.noteEnd(data, 'toolu_01SctF1', true)
  check('toolu_01DocE0', IDS.docs, 'Edit', { file_path: `${ROOT}\\.env` }, 22.5, { decision: 'deny', hook: 'PreToolUse', reason: '.env files are off limits' })
  I.noteEnd(data, 'toolu_01DocE0', false, 'PreToolUse hook blocked this: .env files are off limits')
  check('toolu_01TstB1', IDS.tester, 'Bash', { command: 'npm test -- rateLimit --runInBand', description: 'Run the limiter tests' }, 16, { decision: 'allow', rule: 'Bash(npm test:*)' })
  I.noteEnd(data, 'toolu_01TstB1', true)
  check('toolu_01BldB1', IDS.builder, 'Bash', FORCE_PUSH, 13, { decision: 'ask' })
  I.noteDenied(data, 'toolu_01BldB1', 'Force-pushing to main overwrites history others share; push to the feature branch instead')
  I.noteEnd(data, 'toolu_01BldB1', false, 'Permission for this action has been denied by auto mode.')
  check('toolu_01BldB2', IDS.builder, 'Bash', { command: 'npm test -- rateLimit', description: 'Run the limiter tests' }, 2.5, { decision: 'ask' })
  I.noteDialog(data, 'toolu_01BldB2')

  // the compactions: researcher's own (an agent's: no window known), then the Orchestrator's, 92% → 18% of its window
  I.noteCompaction(data, { agent: IDS.researcher, trigger: 'auto', before: 176_000, after: 44_000, summary: 'Mapping the public routes of the API: 14 found so far in src/app.ts, all after auth(); still to read: src/routes/admin.ts.', at: at(32) })
  I.noteCompaction(data, { agent: M.MAIN, trigger: 'auto', before: 184_000, after: 36_000, summary: SUMMARY, at: at(14) })
}
