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
import { test } from 'claude-code/testing'

/** Where one of the deck's git runs runs: the folder it hands git (`git -C <folder>`, from the session's own folder), else the run's own working folder. */
export function gitWhere(e: { argv: readonly string[]; init?: { cwd?: string } | undefined }): string {
  return e.argv[1] === '-C' ? (e.argv[2] ?? '') : (e.init?.cwd ?? '')
}

/** Whether a git run is the deck's read of where git's settings come from, before each of its runs (`git config --list --show-scope`): a repository with no settings of its own answers it with nothing. */
export function isConfigList(argv: readonly string[]): boolean {
  return argv.join(' ').includes(' config --list --show-scope')
}

/** Bash's own arguments, as its input schema has them. */
export type BashArgs = { command: string; description?: string; timeout?: number; run_in_background?: boolean }

/** A Bash call as `$.tool.call` takes it and a `tool.call` hook sees it; `agentId` puts it in that subagent's loop. */
export function bash(args: BashArgs & { tool_use_id?: string; agentId?: string }): Args<'tool.call'> {
  return { tool: 'Bash', ...args } as unknown as Args<'tool.call'>
}

/**
 * Whether the tests run on Windows, read off this file's own address
 * (`file:///C:/…`, or `file://server/…` on a share); an address the kit does
 * not give counts as Windows. Claude Code resolves the path of a file call
 * the way the host does, so `C:\Users\…` is absolute on Windows alone: on
 * Linux and macOS it reads as a path inside the mod's folder.
 */
export const isWindows = !/^file:\/\/\/(?![a-z]:)/i.test(String((import.meta as { url?: unknown }).url ?? ''))

/** `test` on Windows, and no test elsewhere (the kit has no skip): for a file call's path with a drive letter or an 8.3 short name. */
export const windowsTest: typeof test = isWindows ? test : () => undefined

/** `test` on Linux and macOS, and no test on Windows: for the same rule as a `windowsTest`, spelled with their paths. */
export const posixTest: typeof test = isWindows ? () => undefined : test
