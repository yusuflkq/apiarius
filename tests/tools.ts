/**
 * Bash calls, whatever tool table the engine laid. It writes
 * .claude-plugin/types/claude-code-tools on every load of the mod, from the
 * tools of the session that loaded it, and a session with PowerShell and no
 * Bash leaves Bash out of the tool names: there a literal `{ tool: 'Bash' }`
 * call and `e.tool === 'Bash'` stop compiling. So a test builds its Bash call
 * here, typed loosely, and a hook compares `(e.tool as string) === 'Bash'` and
 * reads the call's arguments as BashArgs. Either way the tests type-check.
 */
import type { Args } from 'claude-code'

/** Bash's own arguments, as its input schema has them. */
export type BashArgs = { command: string; description?: string; timeout?: number; run_in_background?: boolean }

/** A Bash call as `$.tool.call` takes it and a `tool.call` hook sees it; `agentId` puts it in that subagent's loop. */
export function bash(args: BashArgs & { tool_use_id?: string; agentId?: string }): Args<'tool.call'> {
  return { tool: 'Bash', ...args } as unknown as Args<'tool.call'>
}
