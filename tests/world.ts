/**
 * The engine in Claude Code's place for the web deck's Talk, questions and
 * permission prompts (tests/talk.test.ts, tests/questions.test.ts): the
 * server a child the test drives (its stdout the page's commands), every
 * write kept, a question's dialog held open beneath the deck until the test
 * answers it as Claude Code would (or the deck's answer abandons it), model
 * steps the test words, and the permission events it raises.
 */
import type { On, ProcessSpawnChunk, ProcessSpawnRequest, ProcessSpawnResult, ToolCallResult } from 'claude-code'
import { mock, type Engine } from 'claude-code/testing'

import type * as W from '../hooks/web'
import type { DeckSnapshot } from '../types'

export const NOW = 1_700_000_100_000
export const PORT = 4321
const PID = '4242'

/** A child the test drives: what it prints, and when it ends. */
export type Child = { request: ProcessSpawnRequest; print: (text: string) => void; end: () => void; isRead: boolean }

/** A tool call held open beneath the deck, as a dialog holds it: `settle` answers it as Claude Code would; `isAborted` once a hook above returned without it. */
export type Held = { tool: string; id: string; e: Record<string, unknown>; isAborted: boolean; settle: (result: ToolCallResult) => void }

/**
 * A model step the test words: its visible text (streamed as one text
 * chunk), what Claude Code shows of its thinking (each piece a chunk, in
 * block 0, or `[block, text]`), the tools it asks for, and a gate it waits
 * on before it ends.
 */
export type Step = { answer: string; thinking?: (string | readonly [number, string])[]; tools?: string[]; gate?: Promise<void> }

export type World = {
  children: Child[]
  writes: { path: string; text: string }[]
  sent: { to: string; text: string }[]
  /** Why `session.send` refuses, when it does. */
  sendRefusal: string
  submitted: { text: string; origin: unknown }[]
  /** Why a hook beneath drops every prompt submitted, when one does. */
  dropPrompt: string
  /** How the prompt box takes a fill: it does, there is none (the Desktop app), or a dialog holds the keys. */
  fill: 'filled' | 'no_composer' | 'dialog'
  filled: string[]
  toasts: string[]
  notices: { id: string; text: string | undefined }[]
  /** The tools whose calls are held open (AskUserQuestion always is). */
  holding: string[]
  held: Held[]
  steps: Step[]
  /** What `tool.check` decides beneath the deck. */
  verdict: 'allow' | 'ask' | 'deny'
  /** A settings hook decides the permission dialog itself: none shows. */
  isDecided: boolean
  /** What git prints for a command, in a repository the test stands up; left out, there is no repository. */
  git?: (argv: readonly string[]) => { exitCode: number; stdout: string }
  /** The files `fs.read` reads, by their path (`/` between parts, no drive: the engine resolves `/work` to `C:\work` on Windows), when the test gives any: `fs.read` is then the world's. */
  files?: Readonly<Record<string, string>>
  /** What `fs.stat` says of a path, when the test says (null: there is none); left out, every path is a file of 12 bytes, as old as NOW. */
  stat?: (path: string) => { size: number; mtimeMs: number } | null
  /** The plugin's own store (`$.store`: the person's prefs), when the test reads it back; left out, the testing kit's store in memory. */
  store?: Map<string, unknown>
  /** Each pane opened (`$.ui.open`), as asked: its id, and the body rows it asked for. */
  opens: { id: string; rows?: number }[]
  /** Each permission check raised (`tool.check`: a call's, or a plugin's `$.tool.check`), its tool and input as asked. */
  checks: { tool: string; input: unknown }[]
  /** Each turn the deck ended (`$.turn.abort`), by its id. */
  aborted: string[]
  /** How many of a plugin's own permission checks (`$.tool.check`, no call) reject next, as one asked inside a turn being stopped does. */
  checkFails: number
  /** How many redraws the deck asked for (`$.ui.invalidate`). */
  invalidates: number
  /** What /cost totals (`session.usage`'s `cost.usd`), when the test moves it; left out, $1.25. */
  costUsd?: number
}

export function newWorld(extra: Partial<World> = {}): World {
  return {
    children: [],
    writes: [],
    sent: [],
    sendRefusal: '',
    submitted: [],
    dropPrompt: '',
    fill: 'filled',
    filled: [],
    toasts: [],
    notices: [],
    holding: [],
    held: [],
    steps: [],
    verdict: 'ask',
    isDecided: false,
    opens: [],
    checks: [],
    aborted: [],
    checkFails: 0,
    invalidates: 0,
    ...extra,
  }
}

/** Answers every engine call the deck makes, outside a repository; `restored` is the snapshot a reload finds. */
export function world(on: On, w: World, restored?: DeckSnapshot) {
  const store = w.store
  if (store) {
    on('store.get', ($, e) => ({ value: store.get(e.key) }))
    on('store.set', ($, e) => {
      store.set(e.key, JSON.parse(JSON.stringify(e.value)))
      return { value: undefined }
    })
    on('store.delete', ($, e) => {
      store.delete(e.key)
      return { value: undefined }
    })
    on('store.keys', () => ({ value: [...store.keys()] }))
  } else mock.store(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    w.opens.push({ id: e.id, ...(e.rows !== undefined ? { rows: e.rows } : {}) })
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => {
    w.invalidates += 1
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notice', ($, e) => {
    w.notices.push({ id: e.tool_use_id, text: e.text })
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: w.costUsd ?? 1.25 } } }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', ($, e) =>
    e.argv[0] === 'node'
      ? { value: { exitCode: 0, stdout: `${PID}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : w.git && e.argv[0] === 'git'
        ? { value: { ...w.git(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
        : { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } },
  )
  const files = w.files
  if (files) {
    on('fs.read', ($, e) => {
      const text = files[e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')]
      return text !== undefined ? { value: text } : { deny: 'no such file' }
    })
  }
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', ($, e) => {
    const said = w.stat ? w.stat(e.path) : { size: 12, mtimeMs: NOW }
    return said ? { value: { kind: 'file', size: said.size, mtimeMs: said.mtimeMs, isLink: false } } : { deny: 'no such file' }
  })
  on('fs.write', ($, e) => {
    w.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.send', ($, e) => {
    w.sent.push({ to: e.to, text: e.text })
    return w.sendRefusal ? { isDelivered: false, reason: w.sendRefusal } : { isDelivered: true }
  })
  // a message a subagent's loop reads: as it came
  on('session.receive', ($, e) => ({ text: e.text }))
  on('prompt.fill', ($, e) => {
    if (w.fill !== 'filled') return { isFilled: false, refusal: w.fill }
    w.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', ($, e) => {
    w.submitted.push({ text: e.text, origin: e.origin })
    return w.dropPrompt ? { drop: w.dropPrompt } : { text: e.text }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($, e) {
    const step = w.steps.shift() ?? { answer: '' }
    if (step.gate) await step.gate
    for (const piece of step.thinking ?? []) {
      const [index, text] = typeof piece === 'string' ? [0, piece] : piece
      yield { kind: 'thinking' as const, index, text }
    }
    if (step.answer !== '') yield { kind: 'text' as const, index: 1, text: step.answer }
    const toolUses = (step.tools ?? []).map(name => ({ name, input: {} }))
    return { turnId: e.turnId, index: e.index, answer: step.answer, toolUses, stopReason: toolUses.length > 0 ? ('tool_use' as const) : ('end_turn' as const), usage: null }
  })
  on('agent.spawn', () => ({ model: 'claude-haiku', agentId: 'agent-x1' }))
  // an ask is core's (the mode's decider): since 2.1.311 a hook's own ask goes to a person, whom a test has none of; a test's query of its own has nothing beneath, and asks
  on('tool.check', async ($, e, next) => {
    w.checks.push({ tool: e.tool, input: e.input })
    if (w.checkFails > 0 && e.tool_use_id === undefined) {
      w.checkFails -= 1
      throw new Error('Error: The operation was aborted.')
    }
    if (w.verdict !== 'ask') return { decision: w.verdict }
    try {
      return await next(e)
    } catch {
      return { decision: 'ask' as const }
    }
  })
  on('turn.abort', ($, e) => {
    w.aborted.push(e.turnId)
    return { value: undefined }
  })
  on('classic.Stop', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('classic.PermissionRequest', () => (w.isDecided ? { decision: { behavior: 'allow' as const } } : {}))
  on('classic.PermissionDenied', () => ({}))
  on('classic.Notification', () => ({}))
  // a question's dialog, and the calls the test holds, stay open until the test settles them or a hook above leaves them
  on('tool.call', ($, e, next) => {
    if (e.tool === 'AskUserQuestion' || w.holding.includes(e.tool)) {
      return new Promise<ToolCallResult>(resolve => {
        const held: Held = { tool: e.tool, id: e.tool_use_id, e: JSON.parse(JSON.stringify(e)) as Record<string, unknown>, isAborted: false, settle: resolve }
        w.held.push(held)
        next.signal.addEventListener('abort', () => {
          held.isAborted = true
          resolve({ deny: 'abandoned' })
        })
      })
    }
    return e.tool.startsWith('mcp__') ? { deny: 'no such tool' } : { result: 'ok' }
  })
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: 'Browser pane opened.' }], isError: false } }))
  if (restored) on('state.get', { plugin: 'agent-deck', key: 'snapshot' }, () => ({ value: { value: restored, version: 1 } }))
  on('process.spawn', async function* ($, e, next): AsyncGenerator<ProcessSpawnChunk, { value: ProcessSpawnResult } | { deny: string }> {
    const queue: string[] = [`{"ready":${PORT}}\n`]
    let wake: (() => void) | undefined
    let isEnded = false
    const child: Child = {
      request: JSON.parse(JSON.stringify(e)) as ProcessSpawnRequest,
      print: text => {
        queue.push(text)
        wake?.()
      },
      end: () => {
        isEnded = true
        wake?.()
      },
      isRead: true,
    }
    w.children.push(child)
    next.signal.addEventListener('abort', () => child.end())
    try {
      for (;;) {
        const text = queue.shift()
        if (text !== undefined) {
          yield { stream: 'stdout', text }
          continue
        }
        if (isEnded) return { value: { code: 0, signal: null } }
        await new Promise<void>(resolve => {
          wake = resolve
        })
        wake = undefined
      }
    } finally {
      child.isRead = false
    }
  })
}

/** /deck as typed at the prompt, with what the engine stamps on it. */
export function deck(args: string) {
  return { command: 'deck', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 100 } }
}

/** The session starts, you ask, the Orchestrator's turn starts and it starts scout (`agent-x1`); then `/deck web`. */
export async function work($: Engine): Promise<void> {
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'Fix the off-by-one in src/range.js', origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text: 'Fix the off-by-one in src/range.js', turnId: 't1' })
  await $.agent.spawn({
    tool_use_id: 'toolu_scout',
    prompt: 'Find the off-by-one in src/range.js',
    description: 'Find the bug',
    subagentType: 'Explore',
    name: 'scout',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-test',
    background: true,
    fork: false,
  })
  await $.command.run(deck('web'))
}

/** Every state.json written, oldest first. */
export function statesOf(w: World): W.WebState[] {
  return w.writes.filter(one => /[\\/]\.web[\\/]session-1[\\/]state\.json$/.test(one.path)).map(one => JSON.parse(one.text) as W.WebState)
}

/** The latest state.json written. */
export function lastState(w: World): W.WebState {
  const states = statesOf(w)
  const last = states[states.length - 1]
  if (!last) throw new Error('no state.json was written')
  return last
}

/** The page's command, as the server prints it: one line of JSON. */
export function command(child: Child | undefined, cmd: Record<string, unknown>) {
  if (!child) throw new Error('no server is running')
  child.print(`${JSON.stringify(cmd)}\n`)
}

/** One model step of `agentId`'s loop (the Orchestrator's with none), read to its end: what it answered. */
export async function step($: Engine, agentId: string | undefined, index: number) {
  const stream = $.turn.step({ turnId: agentId ? `turn-${agentId}` : 't1', index, model: 'claude-test', messageCount: 3, ...(agentId ? { agentId } : {}) })
  for await (const chunk of stream) void chunk
  return stream.result
}
