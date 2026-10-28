/**
 * Inspect's engine side: what the hooks module's events hand it, and the
 * reads it makes of the engine, each recorded into the deck's data through
 * hooks/inspect.ts. Every function says whether the data changed; the hooks
 * module (register.tsx) registers the events, keeps the data, and saves and
 * draws (`touched`) when one did. Every hook that calls these observes only:
 * it returns what is beneath it, unchanged.
 *
 * - `session.compact`: a compaction that stands (its summary, its tokens
 *   before and after) or one refused; `precompute` is no compaction.
 * - `session.measure`, and each compaction: the context read again as
 *   /context breaks it down (`$.session.usage({ breakdown: 'summary' })`,
 *   which sends no request), at most once every 10 s (`contextWaitOf`).
 * - `prompt.context`: the instruction files the conversation carries;
 *   `classic.InstructionsLoaded`: each one loaded, and why.
 * - A classic hook's input (`classic.UserPromptSubmit`, `PostToolUse`,
 *   `Stop`, `PermissionRequest`, `PermissionDenied`): the main loop's
 *   permission mode and effort.
 * - `classic.ConfigChange`, and the session's start: the model, the output
 *   style and the settings' hooks read again.
 * - `tool.check`, the permission dialog, auto mode's refusal and each call's
 *   start and end: the permission decisions, the skills run, the MCP tools
 *   called.
 */
import type { EngineInterface, SessionCompactInput, SessionCompactResult } from 'claude-code'

import type { DeckData, DeckHook } from '../types'
import * as I from './inspect'
import * as M from './model'

/** The least time between two reads of the context's breakdown. */
export const CONTEXT_EVERY_MS = 10_000

/** The settings sources whose hooks Loaded lists, lowest precedence first. */
const SOURCES = ['user', 'project', 'local', 'policy'] as const

/** When the breakdown was read last, and whether a read runs now. */
const read = { at: 0, isBusy: false }

/** How long until the breakdown may be read again (0: now; a read running counts as just made). */
export function contextWaitOf(now: number): number {
  if (read.isBusy) return CONTEXT_EVERY_MS
  return Math.max(0, read.at + CONTEXT_EVERY_MS - now)
}

/** The context's breakdown read now, and what it lists of what is loaded. Whether it was recorded. */
export async function readInspectContext($: EngineInterface, data: DeckData): Promise<boolean> {
  if (read.isBusy) return false
  read.isBusy = true
  try {
    const raw = await $.session.usage({ breakdown: 'summary' })
    const now = await $.clock.now()
    read.at = now
    const breakdown = raw.context.breakdown
    if (!breakdown) return false
    I.noteBreakdown(data, breakdown, raw.context.window, now)
    return true
  } catch {
    // the breakdown is Inspect's alone: the deck goes on without it
    return false
  } finally {
    read.isBusy = false
  }
}

/** The model, the output style and the hooks of every settings source, as the engine reads them now. Whether they were recorded. */
export async function readInspectLoaded($: EngineInterface, data: DeckData): Promise<boolean> {
  try {
    const at = await $.clock.now()
    let model = ''
    try {
      model = await $.session.model()
    } catch {
      // the model shows once a request reports it
    }
    const hooks: DeckHook[] = []
    for (const source of SOURCES) {
      try {
        hooks.push(...I.hooksOf(await $.settings.read({ source }), source))
      } catch {
        // a source the engine bars from the read lists none
      }
    }
    let outputStyle = ''
    try {
      const style = await $.settings.read({ key: 'outputStyle' })
      if (typeof style === 'string') outputStyle = style
    } catch {
      // none set in the settings: /config's row says it below
    }
    if (outputStyle === '') {
      try {
        const row = (await $.config.list()).find(one => /^output.?style$/i.test(one.key) || /^output style$/i.test(one.label))
        if (row && typeof row.value === 'string') outputStyle = row.value
      } catch {
        // no row for it: the output style is left unsaid
      }
    }
    I.noteLoaded(data, { ...(model ? { model } : {}), ...(outputStyle ? { outputStyle } : {}), hooks }, at)
    return true
  } catch {
    // Loaded stays as it was
    return false
  }
}

/** A `session.compact` and what came of it: one that stands, or one refused; nothing for a `precompute`. Whether it was recorded. */
export async function inspectCompaction($: EngineInterface, data: DeckData, e: SessionCompactInput, result: SessionCompactResult): Promise<boolean> {
  if (e.trigger === 'precompute') return false
  try {
    const at = await $.clock.now()
    const agent = e.agentId ?? M.MAIN
    if (result.skip !== undefined) {
      I.noteCompaction(data, { agent, trigger: e.trigger, summary: '', skipped: result.skip, at })
    } else {
      const summary = result.messages[0]?.text ?? ''
      I.noteCompaction(data, { agent, trigger: e.trigger, summary, at, ...(result.tokensBefore !== undefined ? { before: result.tokensBefore } : {}), ...(result.tokensAfter !== undefined ? { after: result.tokensAfter } : {}) })
    }
    return true
  } catch {
    // the compaction stands whatever the deck makes of it
    return false
  }
}

/** The instruction files `prompt.context` says the conversation carries (its answer's, else its input's). Whether any was recorded. */
export async function inspectInstructions($: EngineInterface, data: DeckData, files: readonly { path: string; kind: string; content: string; parent?: string }[] | undefined): Promise<boolean> {
  if (!files || files.length === 0) return false
  try {
    I.noteInstructions(
      data,
      files.map(file => ({ path: file.path, kind: file.kind, content: file.content, ...(file.parent ? { parent: file.parent } : {}) })),
      await $.clock.now(),
    )
    return true
  } catch {
    // the context goes out whatever the deck makes of it
    return false
  }
}

/** One file classic.InstructionsLoaded says loaded. Whether it was recorded. */
export async function inspectInstructionLoaded($: EngineInterface, data: DeckData, e: { file_path: string; memory_type: string; load_reason: string; trigger_file_path?: string; parent_file_path?: string }): Promise<boolean> {
  try {
    I.noteInstructionLoaded(data, { path: e.file_path, memoryType: e.memory_type, reason: e.load_reason, ...(e.trigger_file_path ? { trigger: e.trigger_file_path } : {}), ...(e.parent_file_path ? { parent: e.parent_file_path } : {}) }, await $.clock.now())
    return true
  } catch {
    // the file is loaded whatever the deck makes of it
    return false
  }
}

/** A classic hook's input: the main loop's mode and effort, kept when they moved. Whether they did. */
export function inspectMode(data: DeckData, input: { permission_mode?: unknown; effort?: unknown; agent_id?: unknown }): boolean {
  try {
    return I.noteMode(data, input)
  } catch {
    // the mode stays as it was heard last
    return false
  }
}

/** A call's `tool.check` verdict: recorded unless it is a query, the deck's own, or a question's. Whether it was. */
export async function inspectCheck($: EngineInterface, data: DeckData, e: { tool: string; input: unknown; tool_use_id?: string; agentId?: string; approver?: string }, verdict: I.CheckIn['verdict'], isOwn: boolean, root: string | null): Promise<boolean> {
  if (isOwn || !e.tool_use_id) return false
  try {
    return I.noteCheck(data, { id: e.tool_use_id, tool: e.tool, input: e.input, agentId: e.agentId ?? M.MAIN, verdict, ...(e.approver ? { approver: e.approver } : {}), at: await $.clock.now(), root }) !== undefined
  } catch {
    // the verdict stands whatever the deck makes of it
    return false
  }
}

/** A permission dialog for call `id` showed, or a PermissionRequest hook answered in its place; and the mode its input names. Whether anything changed. */
export function inspectDialog(data: DeckData, id: string | undefined, result: { decision?: { behavior?: unknown; message?: unknown }; block?: unknown }, input: { permission_mode?: unknown; effort?: unknown; agent_id?: unknown }): boolean {
  const isMode = inspectMode(data, input)
  try {
    return I.noteDialog(data, id, result.decision ?? null, result.block) || isMode
  } catch {
    // the dialog shows whatever the deck makes of it
    return isMode
  }
}

/** Auto mode refused a call (classic.PermissionDenied); and the mode its input names. Whether anything changed. */
export function inspectDenied(data: DeckData, e: { tool_use_id: string; reason: string; permission_mode?: unknown; effort?: unknown; agent_id?: unknown }): boolean {
  const isMode = inspectMode(data, e)
  try {
    return I.noteDenied(data, e.tool_use_id, e.reason) || isMode
  } catch {
    // the refusal stands whatever the deck makes of it
    return isMode
  }
}

/** A call began: a skill run, an MCP tool called. Its own touch follows. */
export function inspectCalled(data: DeckData, tool: string, input: unknown, at: number): void {
  try {
    I.noteCall(data, tool, input, at)
  } catch {
    // the call goes ahead whatever the deck makes of it
  }
}

/**
 * The calls Claude Code ran, by tool_use_id: its classic PostToolUse or
 * PostToolUseFailure named them (`inspectRan`; both fire inside the call,
 * before its `tool.call` resolves), until the call's end takes them
 * (`inspectEnded`). The newest 200: a call whose end never comes (the deck's
 * own, which its `tool.call` hook leaves alone) goes past them.
 */
const ranCalls = new Set<string>()
const MOST_RAN = 200

/** Claude Code ran call `id`: its classic PostToolUse or PostToolUseFailure fired. */
export function inspectRan(id: unknown): void {
  if (typeof id !== 'string' || id === '') return
  ranCalls.add(id)
  for (const old of ranCalls) {
    if (ranCalls.size <= MOST_RAN) break
    ranCalls.delete(old)
  }
}

/**
 * A call ended as `end` says: it ran, or it was refused (`I.refusalOfEnd`:
 * a hook's `deny`, or an error with no PostToolUse or PostToolUseFailure of
 * it, which is how Claude Code hands back a refusal). Its own touch follows.
 */
export function inspectEnded(data: DeckData, id: string, end: I.CallEnd): void {
  try {
    const hasRun = ranCalls.delete(id)
    const refusal = I.refusalOfEnd(end, hasRun)
    I.noteEnd(data, id, refusal === undefined, refusal ?? '')
  } catch {
    // tracking never changes what the tool returned
  }
}
