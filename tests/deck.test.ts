import type { On, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { hunkText, hunksOf } from '../hooks/diff'
import { filesOf, parseLog, parseNumstat, parseStatus } from '../hooks/git'

const HASH = 'a'.repeat(40)
const NOW = 1_700_000_100_000

const PANE = {
  title: 'Agent Deck',
  isFocused: true,
  bodyColumns: 96,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

const VIEWPORT = { columns: 100, rows: 50, isFullscreen: true }

/** /deck as typed at the prompt, with what the engine stamps on it. */
function deck(args: string) {
  return { command: 'deck', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 100 } }
}

/** An Agent tool call's spawn, with the fields the engine fills in. */
function spawn(name: string, description: string, prompt: string) {
  return {
    tool_use_id: `toolu_${name}`,
    prompt,
    description,
    subagentType: 'Explore',
    name,
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-test',
    background: true,
    fork: false,
  }
}

const APP_DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  ' export { a, b }',
  '',
].join('\n')

/** What git prints for each command the deck runs, in a repository at /repo. */
function gitOut(argv: readonly string[]): { exitCode: number; stdout: string } {
  const line = argv.join(' ')
  if (line.includes('rev-parse --show-toplevel')) return { exitCode: 0, stdout: '/repo\n' }
  if (line.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: 'main\n' }
  if (line.includes('rev-parse --verify --quiet HEAD')) return { exitCode: 0, stdout: `${HASH}\n` }
  if (line.includes('@{upstream}')) return { exitCode: 128, stdout: '' }
  if (line.includes('status --porcelain')) return { exitCode: 0, stdout: ' M src/app.ts\0?? notes.txt\0' }
  if (line.includes('--numstat -z HEAD')) return { exitCode: 0, stdout: '1\t1\tsrc/app.ts\0' }
  if (line.includes('-M -U3 HEAD -- src/app.ts')) return { exitCode: 0, stdout: APP_DIFF }
  if (line.includes('rev-list --count')) return { exitCode: 0, stdout: '1\n' }
  if (line.includes(' log --since')) return { exitCode: 0, stdout: '\x1e\n 1 file changed, 2 insertions(+)\n' }
  if (line.includes(' log -n30')) {
    return { exitCode: 0, stdout: `\x1e${HASH}\x1f${HASH.slice(0, 7)}\x1fSam\x1f1700000000\x1fFirst commit\n\n 1 file changed, 2 insertions(+)\n` }
  }
  if (line.includes('show -s')) return { exitCode: 0, stdout: `${HASH}\x1fSam\x1fsam@example.com\x1f1700000000\x1fFirst commit\n` }
  if (line.includes('--numstat -z') && line.includes(HASH)) return { exitCode: 0, stdout: '\n2\t0\tsrc/app.ts\0' }
  if (line.includes('--format= -U3')) return { exitCode: 0, stdout: APP_DIFF }
  return { exitCode: 1, stdout: '' }
}

/** Answers every engine call the deck makes, in Claude Code's place. */
function world(on: On, sent: { to: string; text: string }[] = [], options: { isRepo?: boolean; messages?: SessionMessage[] } = {}) {
  const isRepo = options.isRepo ?? true
  mock.store(on)
  on('session.start', () => ({ cwd: '/repo' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } } }))
  on('session.messages', () => ({ value: options.messages ?? [] }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', ($, e) => ({ value: { ...(isRepo ? gitOut(e.argv) : { exitCode: 128, stdout: '' }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: NOW, isLink: false } }))
  on('fs.read', () => ({ value: 'hello\nworld\n' }))
  on('session.send', ($, e) => {
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku', agentId: 'agent-x1' }))
  on('tool.call', ($, e) => {
    if (e.tool === 'Edit') {
      return {
        result: {
          filePath: '/repo/src/app.ts',
          oldString: 'const b = 2',
          newString: 'const b = 3',
          originalFile: 'const a = 1\nconst b = 2\nexport { a, b }\n',
          structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' const a = 1', '-const b = 2', '+const b = 3', ' export { a, b }'] }],
          userModified: false,
          replaceAll: false,
        },
      }
    }
    return { result: 'ok' }
  })
}

test('/deck opens the pane on the Dashboard; Changes shows git`s files (one opened to git`s own diff) and the commit log; /deck stats lands on Settings and /deck classic on the Dashboard, on each surface', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  const opened = await $.command.run(deck(''))
  expect(opened.text).toBeUndefined()
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-deck', surface, component: 'Pane', requestId: 'agent-deck', viewport: VIEWPORT, props: PANE })
    expect((await ui.find({ key: 'tab:now' }))?.props.dimColor).toBe(false)
    // before the first prompt the header says so; the Orchestrator is the tree's one row
    expect((await ui.find({ key: 'deck:header' }))?.text).toContain('No request yet')
    expect(await ui.find({ key: 'agent:main' })).toBeDefined()

    await ui.press({ key: 'tab:changes' })
    expect((await ui.find({ key: 'tab:changes' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ key: 'tab:now' }))?.props.dimColor).toBe(true)
    expect(await ui.find({ key: 'file:src/app.ts' })).toBeDefined()
    expect(await ui.find({ key: 'file:notes.txt' })).toBeDefined()
    await ui.press({ key: 'file:src/app.ts' })
    expect((await ui.find({ key: 'filediff:src/app.ts' }))?.text).toContain('No agent edited it')
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(String(code?.props.source)).toContain('+const b = 3')
    await ui.press({ key: 'file:src/app.ts' })

    expect(await ui.find({ key: `commit:${HASH}` })).toBeDefined()
    await ui.press({ key: `commit:${HASH}` })
    expect((await ui.findAll({ type: 'Code' })).some(one => String(one.props.source).includes('+const b = 3'))).toBe(true)
    await ui.press({ key: `commit:${HASH}` })
    expect(await ui.find({ key: 'changes:review' })).toBeDefined()

    // the old views' commands land where they went: Stats on Settings (its Inspect), Classic on the Dashboard
    await $.command.run(deck('stats'))
    await ui.redraw()
    expect((await ui.find({ key: 'tab:settings' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ key: 'inspect' }))?.text).toContain('INSPECT')
    await $.command.run(deck('classic'))
    await ui.redraw()
    expect(await ui.find({ key: 'inspect' })).toBeUndefined()
    expect((await ui.find({ key: 'tab:now' }))?.props.dimColor).toBe(false)
    await ui.unmount()
  }
})

test('a subagent shows as a card, its page has its task and the Orchestrator`s page its edit as a diff, and the composer`s @name reaches it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const sent: { to: string; text: string }[] = []
  world(on, sent)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
  await $.turn.start({ text: 'fix the bug in app.ts', turnId: 't1' })
  await $.agent.spawn(spawn('scout', 'hunt the bug', 'Find the bug in src/app.ts'))
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'const b = 2', new_string: 'const b = 3' })
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-deck', surface, component: 'Pane', requestId: 'agent-deck', viewport: VIEWPORT, props: PANE })
    expect((await ui.find({ key: 'agent:agent-x1' }))?.props).toMatchObject({ label: 'scout', plain: true })

    await ui.press({ key: 'agent:main' })
    await ui.press({ key: 'page:fold:edits' })
    expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
    await ui.press({ key: 'page:fold:edits' })
    await ui.press({ key: 'key:b' })

    await ui.press({ key: 'agent:agent-x1' })
    expect((await ui.find({ key: 'page:task' }))?.text).toContain('Find the bug in src/app.ts')
    await ui.press({ key: 'page:chatwith' })
    const field = (await ui.find({ type: 'Input' }))?.key ?? ''
    expect((await ui.find({ type: 'Input' }))?.props.value).toBe('@scout ')
    await ui.input({ key: field, text: `@scout hello from ${surface}` })
    await ui.press({ key: 'tab:now' })
    await ui.unmount()
  }

  expect(sent.map(one => one.text)).toEqual(['hello from terminal', 'hello from desktop'])

  await $.turn.complete({ turnId: 't2', answer: 'Found it: b was 2.', durationMs: 1500, isAborted: false, reason: 'answer', agentId: 'agent-x1' })
  const ui = await $.ui.mount({ plugin: 'agent-deck', surface: 'terminal', component: 'Pane', requestId: 'agent-deck', viewport: VIEWPORT, props: PANE })
  // done: its card says so and what it handed back, and opens its page
  const card = await ui.find({ key: 'card:agent-x1' })
  expect(card?.text).toContain('done')
  expect(card?.text).toContain('Found it: b was 2.')
  await ui.press({ key: 'agent:agent-x1' })
  expect((await ui.find({ key: 'page:result' }))?.text).toContain('Found it: b was 2.')
  await ui.unmount()
})

test('git output parses: renames, untracked counts, the log', async () => {
  const status = parseStatus('R  new.ts\0old.ts\0 M a.ts\0?? b.txt\0')
  expect(status).toEqual([
    { x: 'R', y: ' ', path: 'new.ts', oldPath: 'old.ts' },
    { x: ' ', y: 'M', path: 'a.ts' },
    { x: '?', y: '?', path: 'b.txt' },
  ])
  const numstat = parseNumstat('2\t1\t\0old.ts\0new.ts\0-\t-\timg.png\0')
  expect(numstat).toEqual([
    { path: 'new.ts', oldPath: 'old.ts', added: 2, removed: 1, isBinary: false },
    { path: 'img.png', added: 0, removed: 0, isBinary: true },
  ])
  const files = filesOf(status, numstat, new Map([['b.txt', 7]]))
  expect(files.find(file => file.path === 'b.txt')).toMatchObject({ code: 'N', added: 7, isUntracked: true })
  expect(files.find(file => file.path === 'new.ts')).toMatchObject({ code: 'R', oldPath: 'old.ts', added: 2 })

  const log = parseLog(`\x1e${HASH}\x1fabc1234\x1fSam\x1f1700000000\x1fFix it\n\n 2 files changed, 5 insertions(+), 1 deletion(-)\n`)
  expect(log).toEqual([{ hash: HASH, short: 'abc1234', author: 'Sam', at: 1_700_000_000_000, subject: 'Fix it', files: 2, added: 5, removed: 1 }])
})

test('a hunk cut to fit keeps counts that still parse', async () => {
  const lines = Array.from({ length: 400 }, (_, i) => `+line ${i} ${'x'.repeat(40)}`)
  const [hunk] = hunksOf(`@@ -0,0 +1,400 @@\n${lines.join('\n')}\n`)
  expect(hunk?.newLines).toBe(400)
  const cut = hunkText(hunk!, 2000)
  expect(cut.isCut).toBe(true)
  const [again] = hunksOf(cut.text)
  expect(again?.newLines).toBe(again?.lines.length)
  expect(cut.text.length <= 2000).toBe(true)
})
