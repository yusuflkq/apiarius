/**
 * Inspect's hooks: where the deck hears what hooks/inspect.ts records, every
 * one of them observing only (each returns what is beneath it, unchanged).
 *
 * - `session.compact`: a compaction that stands (its summary, its tokens
 *   before and after) or one refused; `precompute` is no compaction.
 * - `session.measure`, and each compaction: the context read again as
 *   /context breaks it down (`$.session.usage({ breakdown: 'summary' })`,
 *   which sends no request), at most once every 10 s.
 * - `prompt.context`: the instruction files the conversation carries;
 *   `classic.InstructionsLoaded`: each one loaded, and why.
 * - `classic.UserPromptSubmit`, `classic.PostToolUse`, `classic.Stop`: the
 *   main loop's permission mode and effort, as their inputs name them.
 * - `classic.ConfigChange`, and the session's start: the model, the output
 *   style and the settings' hooks read again.
 *
 * register.tsx owns the events it already hears and hands Inspect what they
 * say (`check`, `dialog`, `denied`, `called`, `ended`); the data, the save
 * and the redraw stay its own (`InspectDeps`).
 */
import type { EngineInterface, On, Timer } from 'claude-code'

import type { DeckData, DeckHook } from '../types'
import * as I from './inspect'
import * as M from './model'

/** What Inspect's hooks need of the hooks module: its live data (replaced on a reload or /clear), the save and redraw after a change, and the repository's root (what a call's target is relative to). */
export type InspectDeps = {
  data: () => DeckData
  touched: ($: EngineInterface, now: number) => void
  root: () => string | null
}

/** The least time between two reads of the context's breakdown. */
export const CONTEXT_EVERY_MS = 10_000

/** The settings sources whose hooks Loaded lists, lowest precedence first. */
const SOURCES = ['user', 'project', 'local', 'policy'] as const

/** Inspect's hooks and its hand-offs, over `deps`. */
export function inspectHooks(deps: InspectDeps) {
  const read = { at: 0, isBusy: false, isAgain: false, timer: undefined as Timer | undefined }

  /** The context's breakdown read now, and what it lists of what is loaded; another read asked for meanwhile follows it. */
  async function readContext($: EngineInterface): Promise<void> {
    if (read.isBusy) {
      read.isAgain = true
      return
    }
    read.isBusy = true
    try {
      const raw = await $.session.usage({ breakdown: 'summary' })
      const now = await $.clock.now()
      read.at = now
      const breakdown = raw.context.breakdown
      if (breakdown) {
        I.noteBreakdown(deps.data(), breakdown, raw.context.window, now)
        deps.touched($, now)
      }
    } catch {
      // the breakdown is Inspect's alone: the deck goes on without it
    } finally {
      read.isBusy = false
    }
    if (read.isAgain) {
      read.isAgain = false
      want($)
    }
  }

  /** A read of the context asked for: now when the last was 10 s ago or more, else once when that has passed. */
  function want($: EngineInterface): void {
    void (async () => {
      const now = await $.clock.now()
      const wait = read.at + CONTEXT_EVERY_MS - now
      if (wait <= 0) {
        void readContext($)
        return
      }
      if (read.timer) return
      read.timer = $.clock.after(wait, () => {
        read.timer = undefined
        void readContext($)
      })
    })().catch(() => {
      // a read missed now is made at the next measure
    })
  }

  /** The model, the output style and the hooks of every settings source, as the engine reads them now. */
  async function readLoaded($: EngineInterface): Promise<void> {
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
      I.noteLoaded(deps.data(), { ...(model ? { model } : {}), ...(outputStyle ? { outputStyle } : {}), hooks }, at)
      deps.touched($, at)
    } catch {
      // Loaded stays as it was
    }
  }

  /** A classic hook's input: the main loop's mode and effort, kept when they moved. */
  async function hearMode($: EngineInterface, input: { permission_mode?: unknown; effort?: unknown; agent_id?: unknown }): Promise<void> {
    try {
      if (I.noteMode(deps.data(), input)) deps.touched($, await $.clock.now())
    } catch {
      // the mode stays as it was heard last
    }
  }

  return {
    /** Registers the events Inspect hears on its own (none of them register.tsx's). */
    register(on: On): void {
      on('session.compact', async ($, e, next) => {
        const result = await next(e)
        try {
          if (e.trigger !== 'precompute') {
            const at = await $.clock.now()
            const agent = e.agentId ?? M.MAIN
            if (result.skip !== undefined) {
              I.noteCompaction(deps.data(), { agent, trigger: e.trigger, summary: '', skipped: result.skip, at })
            } else {
              const summary = result.messages[0]?.text ?? ''
              I.noteCompaction(deps.data(), { agent, trigger: e.trigger, summary, at, ...(result.tokensBefore !== undefined ? { before: result.tokensBefore } : {}), ...(result.tokensAfter !== undefined ? { after: result.tokensAfter } : {}) })
              want($)
            }
            deps.touched($, at)
          }
        } catch {
          // the compaction stands whatever the deck makes of it
        }
        return result
      })

      // the engine measured the session (after each main-thread turn): the breakdown read again, at most every 10 s
      on('session.measure', async ($, e, next) => {
        const result = await next(e)
        want($)
        return result
      })

      on('prompt.context', async ($, e, next) => {
        const result = await next(e)
        try {
          const files = result.instructionFiles ?? e.instructionFiles
          if (files && files.length > 0) {
            const at = await $.clock.now()
            I.noteInstructions(
              deps.data(),
              files.map(file => ({ path: file.path, kind: file.kind, content: file.content, ...(file.parent ? { parent: file.parent } : {}) })),
              at,
            )
            deps.touched($, at)
          }
        } catch {
          // the context goes out whatever the deck makes of it
        }
        return result
      })

      on('classic.InstructionsLoaded', async ($, e, next) => {
        const result = await next(e)
        try {
          const at = await $.clock.now()
          I.noteInstructionLoaded(deps.data(), { path: e.file_path, memoryType: e.memory_type, reason: e.load_reason, ...(e.trigger_file_path ? { trigger: e.trigger_file_path } : {}), ...(e.parent_file_path ? { parent: e.parent_file_path } : {}) }, at)
          deps.touched($, at)
        } catch {
          // the file is loaded whatever the deck makes of it
        }
        return result
      })

      on('classic.UserPromptSubmit', async ($, e, next) => {
        const result = await next(e)
        await hearMode($, e)
        return result
      })

      on('classic.PostToolUse', async ($, e, next) => {
        const result = await next(e)
        await hearMode($, e)
        return result
      })

      on('classic.Stop', async ($, e, next) => {
        const result = await next(e)
        await hearMode($, e)
        return result
      })

      // a settings file changed: its hooks and the output style read again
      on('classic.ConfigChange', async ($, e, next) => {
        const result = await next(e)
        void readLoaded($)
        return result
      })
    },

    /** The session started (or the mod loaded again): what is loaded, and the context, read. */
    async start($: EngineInterface): Promise<void> {
      await readLoaded($)
      await readContext($)
    },

    /** A call's `tool.check` verdict (register.tsx's hook): recorded unless it is a query, the deck's own, or a question's. */
    async check($: EngineInterface, e: { tool: string; input: unknown; tool_use_id?: string; agentId?: string; approver?: string }, verdict: I.CheckIn['verdict'], isOwn: boolean): Promise<void> {
      if (isOwn || !e.tool_use_id) return
      try {
        const at = await $.clock.now()
        const made = I.noteCheck(deps.data(), { id: e.tool_use_id, tool: e.tool, input: e.input, agentId: e.agentId ?? M.MAIN, verdict, ...(e.approver ? { approver: e.approver } : {}), at, root: deps.root() })
        if (made) deps.touched($, at)
      } catch {
        // the verdict stands whatever the deck makes of it
      }
    },

    /** A permission dialog for call `id` showed, or a PermissionRequest hook answered in its place (register.tsx's classic.PermissionRequest). */
    async dialog($: EngineInterface, id: string | undefined, result: { decision?: { behavior?: unknown; message?: unknown }; block?: unknown }, input: { permission_mode?: unknown; effort?: unknown; agent_id?: unknown }): Promise<void> {
      await hearMode($, input)
      try {
        if (I.noteDialog(deps.data(), id, result.decision ?? null, result.block)) deps.touched($, await $.clock.now())
      } catch {
        // the dialog shows whatever the deck makes of it
      }
    },

    /** Auto mode refused call `id` (register.tsx's classic.PermissionDenied). */
    async denied($: EngineInterface, e: { tool_use_id: string; reason: string; permission_mode?: unknown; agent_id?: unknown }): Promise<void> {
      await hearMode($, e)
      try {
        if (I.noteDenied(deps.data(), e.tool_use_id, e.reason)) deps.touched($, await $.clock.now())
      } catch {
        // the refusal stands whatever the deck makes of it
      }
    },

    /** A call began (register.tsx's tool.call): a skill run, an MCP tool called. Its own touch follows. */
    called(tool: string, input: unknown, at: number): void {
      try {
        I.noteCall(deps.data(), tool, input, at)
      } catch {
        // the call goes ahead whatever the deck makes of it
      }
    },

    /** Call `id` ended: it ran, or it was refused with `refusal` (register.tsx's tool.call). Its own touch follows. */
    ended(id: string, ran: boolean, refusal: string): void {
      try {
        I.noteEnd(deps.data(), id, ran, refusal)
      } catch {
        // tracking never changes what the tool returned
      }
    },
  }
}
