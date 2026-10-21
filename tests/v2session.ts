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
 * deck: delivered, queued, failed.
 *
 * Plain TypeScript that Node runs as it is (no `claude-code` import), so the
 * fixture's generator can load it.
 */
import type { DeckAgent, DeckData, DeckEdit, DeckQuestion } from '../types'
import { emptyGit, type GitState } from '../hooks/git'
import * as M from '../hooks/model'
import type { UsageInfo } from '../hooks/ui/types'

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

function patchOf(path: string, lines: string[], isNew = false): string {
  // the hunk's counts as git writes them: the old side its context and removed lines, the new side its context and added lines
  const before = lines.filter(line => !line.startsWith('+')).length
  const after = lines.filter(line => !line.startsWith('-')).length
  const head = isNew ? `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n` : `--- a/${path}\n+++ b/${path}\n@@ -1,${before} +1,${after} @@\n`
  return `${head}${lines.join('\n')}\n`
}

/** A tool call made and ended in an agent's loop, `ms` long. */
function call(data: DeckData, agent: DeckAgent, id: string, tool: string, input: Record<string, unknown>, at: number, ms: number, ok = true) {
  M.beginTool(data, agent, M.activityOf(id, tool, input, ROOT, at))
  M.endTool(agent, id, ok, at + ms)
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

export type V2Session = { data: DeckData; git: GitState; usage: UsageInfo; now: number; sessionId: string; cwd: string; answerable: Set<string> }

export function v2Session(): V2Session {
  const data = M.emptyData(ago(42))
  const main = M.agentOf(data, M.MAIN) as DeckAgent
  Object.assign(main, { status: 'running', model: 'claude-opus-5-5', tokensIn: 182_400, tokensOut: 21_300, cacheRead: 1_204_000, requests: 31 })

  // you asked; the main loop's turn runs since
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: PROMPT, at: ago(40) })
  M.noteGoal(data, 'goal', { text: PROMPT, origin: 'composer', at: ago(40) })
  M.noteMainTurn(data, 'turn-7c1e', ago(40))

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
  call(data, researcher, 'toolu_01ResG1', 'Grep', { pattern: 'router\\.(get|post)', path: `${ROOT}\\src` }, ago(34), 900)
  call(data, researcher, 'toolu_01ResR1', 'Read', { file_path: `${ROOT}\\src\\app.ts` }, ago(33), 300)
  M.noteResult(data, researcher, 'Found 14 public routes, all mounted in `src/app.ts` after `auth()`. No limiter exists. The Redis client (`ioredis`) is already a dependency.', ago(31), 'handback')
  Object.assign(researcher, { status: 'completed', endedAt: ago(31), tokensIn: 41_000, tokensOut: 2_100, cacheRead: 88_000, requests: 6 })

  // the Orchestrator's answer to you: long, so its whole text is a lazy file
  M.addMessage(data, { from: M.MAIN, to: M.YOU, kind: 'answer', text: ANSWER, at: ago(30) })
  M.noteMainAnswer(main, ANSWER)

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
    patch: patchOf('src/rateLimit.ts', ['+export type Store = { hit(key: string, now: number): Promise<number> }', '+', '+export function limiter(store: Store, perMinute = 100) {', '+  return async (key: string, now = Date.now()) => (await store.hit(key, now)) <= perMinute', '+}', '+'], true),
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
  call(data, tester, 'toolu_01TstB1', 'Bash', { command: 'npm test -- rateLimit --runInBand', description: 'Run the limiter tests' }, ago(16), 8_400)
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
  call(data, docs, 'toolu_01DocE1', 'Edit', { file_path: `${ROOT}\\docs\\api.md` }, ago(23), 250)
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
  call(data, scout, 'toolu_01SctF1', 'WebFetch', { url: 'https://github.com/redis/ioredis#readme' }, ago(24), 1_800)
  Object.assign(scout, { status: 'killed', endedAt: ago(22), tokensIn: 6_000, tokensOut: 300, cacheRead: 9_000, requests: 2 })

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
  M.addMessage(data, { from: IDS.builder, to: IDS.reviewer, kind: 'message', title: 'Limiter ready for review', text: '`src/rateLimit.ts` and both stores are in. The tests pass against the in-memory store; the Redis one needs a server.', at: ago(9), isDelivered: true })
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
  const usage: UsageInfo = { startedAt: ago(42), contextPercent: 41, costUsd: 4.12, limits: [] }
  return { data, git, usage, now: SAMPLE_NOW, sessionId: '5f2c8a1e-7b3d-4c9a-9e61-2d4f8b0c3a17', cwd: ROOT, answerable: new Set(['toolu_01AskOne', 'toolu_01AskMany']) }
}
